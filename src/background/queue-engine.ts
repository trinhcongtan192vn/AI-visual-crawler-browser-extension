// 05 — Queue Engine. Bộ não điều phối: state machine + vòng lặp tuần tự. Không chạm DOM, không parse Excel.
import type { BatchState, BatchStatus, ErrorType, Job, RunConfig } from '../shared/types';
import type { GenerateRes, ProgressMsg } from '../shared/messages';
import { CONSECUTIVE_ANOMALY_THRESHOLD, MAX_AUTO_RETRY, RETRY_BACKOFF, TIMEOUTS } from '../shared/constants';
import { createLogger } from '../shared/logger';
import * as persistence from './persistence';
import * as tabManager from './tab-manager';
import * as downloadManager from './download-manager';
import { DownloadError } from './download-manager';
import * as manifestWriter from './manifest-writer';

const log = createLogger('queue-engine');
const KEEPALIVE_ALARM = 'avg-keepalive';

let currentBatch: BatchState | null = null;
let loopRunning = false;
let consecutiveAnomalies = 0;
let broadcaster: ((msg: ProgressMsg) => void) | null = null;

export function setBroadcaster(fn: (msg: ProgressMsg) => void): void {
  broadcaster = fn;
}

function emit(msg: ProgressMsg): void {
  try {
    broadcaster?.(msg);
  } catch (err) {
    log.warn('broadcast failed', err);
  }
}

export function getBatch(): BatchState | null {
  return currentBatch;
}

function newBatchId(): string {
  return crypto.randomUUID();
}

function isRetryable(t: ErrorType): boolean {
  return t === 'TIMEOUT' || t === 'SELECTOR_MISS' || t === 'PROVIDER_ERROR' || t === 'DOWNLOAD_FAILED' || t === 'UNKNOWN';
}

function randomBetween(range: { min: number; max: number }): number {
  const { min, max } = range;
  if (max <= min) return min;
  return min + Math.floor(Math.random() * (max - min + 1));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timeoutFor(kind: Job['kind']): number {
  return kind === 'video' ? TIMEOUTS.videoDone : TIMEOUTS.imageDone;
}

function setJob(job: Job, status: Job['status']): void {
  job.status = status;
  if (status === 'running') job.startedAt = Date.now();
  if (status === 'done' || status === 'failed' || status === 'skipped') job.finishedAt = Date.now();
  emit({ type: 'JOB_UPDATE', job });
}

function recomputeCounters(batch: BatchState): void {
  batch.counters = {
    total: batch.jobs.length,
    done: batch.jobs.filter((j) => j.status === 'done').length,
    failed: batch.jobs.filter((j) => j.status === 'failed').length,
    skipped: batch.jobs.filter((j) => j.status === 'skipped').length
  };
}

async function persistAndBroadcast(batch: BatchState): Promise<void> {
  recomputeCounters(batch);
  await persistence.persist(batch);
  emit({ type: 'BATCH_UPDATE', status: batch.status, counters: batch.counters });
}

function startKeepAlive(): void {
  chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
}

function stopKeepAlive(): void {
  chrome.alarms.clear(KEEPALIVE_ALARM);
}

export function handleAlarm(alarm: chrome.alarms.Alarm): void {
  if (alarm.name === KEEPALIVE_ALARM) {
    log.debug('keepalive tick', { status: currentBatch?.status, currentIndex: currentBatch?.currentIndex });
  }
}

async function haltBatch(batch: BatchState, status: BatchStatus, reason: string, job?: Job): Promise<void> {
  if (job && job.status === 'running') {
    job.status = 'pending';
    job.startedAt = undefined;
    emit({ type: 'JOB_UPDATE', job });
  }
  batch.status = status;
  batch.attentionReason = reason;
  await persistAndBroadcast(batch);
  emit({ type: 'NEEDS_ATTENTION', reason, blockId: job?.blockId });
  log.warn(`Batch halted: ${status} — ${reason}`);
}

/** Đảm bảo có tab provider sẵn sàng (đã mở + content script phản hồi + đã đăng nhập); tự halt batch khi không đạt. */
async function ensureTabReady(batch: BatchState, job?: Job): Promise<number | null> {
  let tabId: number;
  try {
    tabId = await tabManager.ensureProviderTab(batch.config.provider);
  } catch (err) {
    await haltBatch(batch, 'needs_attention', `Không mở được tab ${batch.config.provider}: ${(err as Error).message}`, job);
    return null;
  }

  const ready = await tabManager.ping(tabId);
  if (!ready.ok) {
    await haltBatch(
      batch,
      'needs_attention',
      `Không kết nối được với tab ${batch.config.provider} (content script không phản hồi). Hãy tải lại (F5) tab đó rồi bấm Tiếp tục.`,
      job
    );
    return null;
  }
  if (!ready.loggedIn) {
    await haltBatch(batch, 'needs_attention', `Chưa đăng nhập ${batch.config.provider}`, job);
    return null;
  }
  return tabId;
}

/**
 * Gửi nội dung chính của video (nhập ở Import) làm tin nhắn đầu tiên của phiên chat, trước
 * khi chạy block nào. Chỉ chạy một lần cho cả batch (đánh dấu batch.contextSent) — không
 * chạy lại khi resume. Lỗi cấp phiên (RATE_LIMIT/NOT_LOGGED_IN) vẫn dừng batch như bình
 * thường; lỗi khác (VD selector miss) không chặn batch vì đây là bước tùy chọn — chỉ cảnh
 * báo rồi chạy tiếp không có ngữ cảnh.
 * @returns false nếu batch bị halt (runLoop phải dừng ngay), true nếu có thể chạy tiếp.
 */
async function sendVideoContextIfNeeded(batch: BatchState): Promise<boolean> {
  const text = batch.config.videoContext?.trim();
  if (!text || batch.contextSent) return true;

  const tabId = await ensureTabReady(batch);
  if (tabId === null) return false;

  const requestId = crypto.randomUUID();
  const res = await tabManager.sendContext(tabId, { requestId, text }, TIMEOUTS.contextMessageDone);

  if (res.ok) {
    batch.contextSent = true;
    await persistAndBroadcast(batch);
    return true;
  }

  if (res.errorType === 'RATE_LIMIT') {
    await haltBatch(batch, 'stopped_rate_limit', `Bị giới hạn bởi ${batch.config.provider} khi gửi ngữ cảnh đầu phiên`);
    return false;
  }
  if (res.errorType === 'NOT_LOGGED_IN') {
    await haltBatch(batch, 'needs_attention', 'Phiên đăng nhập hết hạn khi gửi ngữ cảnh đầu phiên');
    return false;
  }

  log.warn(`Gửi ngữ cảnh đầu phiên thất bại (${res.errorType}: ${res.message}) — tiếp tục batch không có ngữ cảnh`);
  batch.contextSent = true; // đã thử — không lặp lại lỗi này ở mỗi lần resume
  await persistAndBroadcast(batch);
  return true;
}

async function saveResult(
  batch: BatchState,
  job: Job,
  tabId: number,
  requestId: string,
  res: Extract<GenerateRes, { type: 'GENERATE_RESULT' }>
): Promise<string> {
  const fileName = downloadManager.buildFileName(job, batch);
  if (res.captureMode === 'url') {
    return downloadManager.saveByUrl(res.mediaUrl, fileName, batch.config.outputFolder);
  }
  return downloadManager.captureNextPageTriggeredDownload(fileName, batch.config.outputFolder, async () => {
    await tabManager.triggerDownload(tabId, requestId);
  });
}

async function runLoop(batch: BatchState): Promise<void> {
  if (loopRunning) return;
  loopRunning = true;
  startKeepAlive();
  try {
    if (batch.status !== 'running') return;
    if (!(await sendVideoContextIfNeeded(batch))) return; // đã halt bên trong nếu false

    while (batch.currentIndex < batch.jobs.length) {
      if (batch.status !== 'running') return;
      const job = batch.jobs[batch.currentIndex];

      if (job.status === 'done' || job.status === 'skipped') {
        batch.currentIndex++;
        continue;
      }

      setJob(job, 'running');

      const tabId = await ensureTabReady(batch, job);
      if (tabId === null) return;

      const requestId = crypto.randomUUID();
      const res = await tabManager.generate(
        tabId,
        { requestId, prompt: job.prompt, kind: job.kind, aspectRatio: batch.config.aspectRatio },
        timeoutFor(job.kind)
      );

      if (res.type === 'GENERATE_RESULT' && res.ok) {
        consecutiveAnomalies = 0;
        try {
          const fileName = await saveResult(batch, job, tabId, requestId, res);
          job.outputFileName = fileName;
          job.outputMediaType = res.mediaType;
          setJob(job, 'done');
          manifestWriter.recordJob(batch, job, batch.config);
          batch.currentIndex++;
          await persistAndBroadcast(batch);
          await delay(randomBetween(batch.config.interBlockDelayMs));
        } catch (err) {
          const message = err instanceof DownloadError ? err.message : String(err);
          job.lastError = { type: 'DOWNLOAD_FAILED', message };
          await handleBlockError(batch, job, 'DOWNLOAD_FAILED', message);
        }
        continue;
      }

      const errorType = res.type === 'GENERATE_ERROR' ? res.errorType : 'UNKNOWN';
      const message = res.type === 'GENERATE_ERROR' ? res.message : 'Phản hồi không hợp lệ từ content script';

      if (errorType === 'RATE_LIMIT') {
        await haltBatch(batch, 'stopped_rate_limit', `Bị giới hạn bởi ${batch.config.provider}`, job);
        return;
      }
      if (errorType === 'NOT_LOGGED_IN') {
        await haltBatch(batch, 'needs_attention', 'Phiên đăng nhập hết hạn', job);
        return;
      }

      await handleBlockError(batch, job, errorType, message);
      if ((batch.status as BatchStatus) !== 'running') return;
    }
    await finishBatch(batch);
  } finally {
    loopRunning = false;
    stopKeepAlive();
  }
}

/** Lỗi cấp block: auto-retry <= MAX_AUTO_RETRY rồi mới failed; job giữ nguyên vị trí để thử lại. */
async function handleBlockError(batch: BatchState, job: Job, errorType: ErrorType, message: string): Promise<void> {
  job.lastError = { type: errorType, message };

  // Fallback phát hiện rate-limit ngầm (09.4): N job liên tiếp CÙNG loại TIMEOUT/PROVIDER_ERROR.
  if (errorType === 'TIMEOUT' || errorType === 'PROVIDER_ERROR') {
    consecutiveAnomalies++;
    if (consecutiveAnomalies >= CONSECUTIVE_ANOMALY_THRESHOLD) {
      consecutiveAnomalies = 0;
      await haltBatch(batch, 'needs_attention', `${CONSECUTIVE_ANOMALY_THRESHOLD} block liên tiếp lỗi ${errorType} — nghi ngờ bị chặn, cần kiểm tra thủ công`, job);
      return;
    }
  } else {
    consecutiveAnomalies = 0;
  }

  if (job.attempts < MAX_AUTO_RETRY && errorType !== 'UNSUPPORTED' && isRetryable(errorType)) {
    job.attempts++;
    setJob(job, 'pending');
    await persistAndBroadcast(batch);
    await delay(RETRY_BACKOFF[job.attempts] ?? RETRY_BACKOFF[RETRY_BACKOFF.length - 1]);
    // giữ nguyên currentIndex để thử lại chính job này
  } else {
    setJob(job, 'failed');
    manifestWriter.recordJob(batch, job, batch.config);
    batch.currentIndex++;
    await persistAndBroadcast(batch);
  }
}

async function finishBatch(batch: BatchState): Promise<void> {
  batch.status = 'done';
  await persistAndBroadcast(batch);
  const summary = {
    total: batch.counters.total,
    done: batch.counters.done,
    failed: batch.counters.failed,
    skipped: batch.counters.skipped,
    failedBlockIds: batch.jobs.filter((j) => j.status === 'failed').map((j) => j.blockId),
    folder: batch.config.outputFolder
  };
  emit({ type: 'BATCH_DONE', summary });
  log.info('Batch done', summary);
}

// ---- API điều khiển từ panel ----

export async function startBatch(jobs: Job[], config: RunConfig): Promise<BatchState> {
  const batch: BatchState = {
    batchId: newBatchId(),
    status: 'running',
    config,
    jobs,
    currentIndex: 0,
    counters: { total: jobs.length, done: 0, failed: 0, skipped: jobs.filter((j) => j.status === 'skipped').length },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    manifestRecords: []
  };
  currentBatch = batch;
  consecutiveAnomalies = 0;
  await persistAndBroadcast(batch);
  void runLoop(batch);
  return batch;
}

export async function pauseBatch(): Promise<void> {
  if (!currentBatch) return;
  currentBatch.status = 'paused';
  await persistAndBroadcast(currentBatch);
}

export async function resumeBatch(): Promise<void> {
  if (!currentBatch) return;
  if (currentBatch.status !== 'paused' && currentBatch.status !== 'stopped_rate_limit' && currentBatch.status !== 'needs_attention') {
    return;
  }
  currentBatch.status = 'running';
  currentBatch.attentionReason = undefined;
  consecutiveAnomalies = 0;
  await persistAndBroadcast(currentBatch);
  void runLoop(currentBatch);
}

export async function retryJob(blockId: string): Promise<void> {
  if (!currentBatch) return;
  const idx = currentBatch.jobs.findIndex((j) => j.blockId === blockId);
  if (idx === -1) return;
  const job = currentBatch.jobs[idx];
  job.status = 'pending';
  job.attempts = 0;
  job.lastError = undefined;
  if (idx < currentBatch.currentIndex) currentBatch.currentIndex = idx;
  emit({ type: 'JOB_UPDATE', job });
  await persistAndBroadcast(currentBatch);
  if (currentBatch.status === 'running') void runLoop(currentBatch);
}

export async function retryAllFailed(): Promise<void> {
  if (!currentBatch) return;
  let minIdx = currentBatch.currentIndex;
  currentBatch.jobs.forEach((job, idx) => {
    if (job.status === 'failed') {
      job.status = 'pending';
      job.attempts = 0;
      job.lastError = undefined;
      emit({ type: 'JOB_UPDATE', job });
      if (idx < minIdx) minIdx = idx;
    }
  });
  currentBatch.currentIndex = minIdx;
  await persistAndBroadcast(currentBatch);
  if (currentBatch.status === 'running') void runLoop(currentBatch);
}

export async function cancelBatch(): Promise<void> {
  if (!currentBatch) return;
  currentBatch.status = 'cancelled';
  await persistAndBroadcast(currentBatch);
}

export async function exportManifest(): Promise<void> {
  if (!currentBatch) return;
  await manifestWriter.exportManifest(currentBatch);
}

/** Gọi khi worker khởi động lại (onStartup / message đầu tiên) — hồi phục job kẹt ở 'running' (05.7). */
export async function recoverOnStartup(): Promise<void> {
  const loaded = await persistence.loadBatch();
  if (!loaded) return;
  currentBatch = loaded;
  const stuck = loaded.jobs.find((j) => j.status === 'running');
  if (stuck) {
    stuck.status = 'pending';
    stuck.startedAt = undefined;
    log.info(`Hồi phục job kẹt ở running: ${stuck.blockId} -> pending`);
  }
  if (loaded.status === 'running') {
    await persistence.persist(loaded);
    void runLoop(loaded);
  }
}

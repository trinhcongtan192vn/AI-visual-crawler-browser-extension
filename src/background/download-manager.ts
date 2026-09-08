// 07 — Download Manager. Nơi duy nhất gọi chrome.downloads. Đặt tên + hai đường tải (07.1, 07.2).
import type { BatchState, Job } from '../shared/types';
import { TIMEOUTS } from '../shared/constants';
import { createLogger } from '../shared/logger';

const log = createLogger('download-manager');

export class DownloadError extends Error {}

function sanitizeBlockIdForFile(blockId: string): string {
  const cleaned = blockId.replace(/[\\/:*?"<>|]/g, '').trim();
  return cleaned || 'block_unknown';
}

/** Đếm số lần block này đã được tải thành công trong batch để suy ra hậu tố _vN khi retry/regenerate. */
function nextVersionSuffix(batch: BatchState, blockId: string): string {
  const priorDone = batch.manifestRecords.filter(
    (r) => r.blockId === blockId && r.status === 'done' && r.outputFileName
  ).length;
  return priorDone > 0 ? `_v${priorDone + 1}` : '';
}

export function buildFileName(job: Job, batch: BatchState): string {
  const safeId = sanitizeBlockIdForFile(job.blockId);
  const version = nextVersionSuffix(batch, job.blockId);
  if (job.downgraded) {
    return `${safeId}${version}_img.png`;
  }
  if (job.kind === 'video') {
    return `${safeId}${version}.mp4`;
  }
  return `${safeId}${version}.png`;
}

export async function waitDownloadComplete(id: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      chrome.downloads.onChanged.removeListener(listener);
      reject(new DownloadError('Hết thời gian chờ tải file'));
    }, timeoutMs);

    function listener(delta: chrome.downloads.DownloadDelta) {
      if (delta.id !== id) return;
      if (delta.state?.current === 'complete') {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        chrome.downloads.onChanged.removeListener(listener);
        resolve();
      } else if (delta.state?.current === 'interrupted') {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        chrome.downloads.onChanged.removeListener(listener);
        reject(new DownloadError('Tải file bị gián đoạn'));
      }
    }

    chrome.downloads.onChanged.addListener(listener);
  });
}

/** Đường A — có URL (href hoặc data URL từ content script). */
export async function saveByUrl(url: string, fileName: string, folder: string): Promise<string> {
  const downloadId = await chrome.downloads.download({
    url,
    filename: `${folder}/${fileName}`,
    conflictAction: 'uniquify',
    saveAs: false
  });
  await waitDownloadComplete(downloadId, TIMEOUTS.downloadComplete);
  log.info(`Saved ${fileName} via URL (downloadId=${downloadId})`);
  return fileName;
}

/** Đường B — trang tự tải, worker bắt qua onDeterminingFilename và đổi tên (07.2). */
let expectingCapture = false;
let pendingFileName = '';
let pendingFolder = '';

chrome.downloads.onDeterminingFilename.addListener((_item, suggest) => {
  if (expectingCapture) {
    expectingCapture = false;
    suggest({ filename: `${pendingFolder}/${pendingFileName}`, conflictAction: 'uniquify' });
  }
});

export async function captureNextPageTriggeredDownload(
  fileName: string,
  folder: string,
  triggerDownload: () => Promise<void> | void,
  timeoutMs: number = TIMEOUTS.pageTriggeredCapture
): Promise<string> {
  pendingFileName = fileName;
  pendingFolder = folder;
  expectingCapture = true;

  const captured = new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.downloads.onCreated.removeListener(onCreated);
      expectingCapture = false;
      reject(new DownloadError('Không bắt được file trang tự tải trong thời gian chờ'));
    }, timeoutMs);

    function onCreated(item: chrome.downloads.DownloadItem) {
      clearTimeout(timer);
      chrome.downloads.onCreated.removeListener(onCreated);
      resolve(item.id);
    }

    chrome.downloads.onCreated.addListener(onCreated);
  });

  await triggerDownload();
  const downloadId = await captured;
  await waitDownloadComplete(downloadId, TIMEOUTS.downloadComplete);
  log.info(`Captured page-triggered download as ${fileName} (downloadId=${downloadId})`);
  return fileName;
}

// Test cho tính năng mới: nội dung chính của video (nhập ở Import) được gửi làm tin nhắn
// ĐẦU TIÊN của phiên chat, trước khi chạy block nào. Nếu để trống thì bỏ qua hoàn toàn.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../tab-manager', () => ({
  ensureProviderTab: vi.fn(),
  ping: vi.fn(),
  sendContext: vi.fn(),
  generate: vi.fn(),
  triggerDownload: vi.fn()
}));
vi.mock('../persistence', () => ({
  persist: vi.fn().mockResolvedValue(undefined),
  loadBatch: vi.fn().mockResolvedValue(null),
  clearBatch: vi.fn().mockResolvedValue(undefined),
  saveLastConfig: vi.fn().mockResolvedValue(undefined),
  loadLastConfig: vi.fn().mockResolvedValue(null)
}));
vi.mock('../manifest-writer', () => ({
  recordJob: vi.fn(),
  buildManifestCsv: vi.fn().mockReturnValue(''),
  exportManifest: vi.fn().mockResolvedValue(undefined)
}));
vi.mock('../download-manager', () => ({
  buildFileName: vi.fn().mockReturnValue('B01.png'),
  saveByUrl: vi.fn().mockResolvedValue('B01.png'),
  captureNextPageTriggeredDownload: vi.fn().mockResolvedValue('B01.png'),
  DownloadError: class DownloadError extends Error {}
}));

import * as tabManager from '../tab-manager';
import * as queueEngine from '../queue-engine';
import type { Job, RunConfig } from '../../shared/types';

function makeConfig(overrides: Partial<RunConfig> = {}): RunConfig {
  return {
    provider: 'gemini',
    aspectRatio: '16:9',
    outputFolder: 'test',
    interBlockDelayMs: { min: 0, max: 0 },
    promptTemplates: { image: '', video: '' },
    ...overrides
  };
}

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    blockId: 'B01',
    kind: 'image',
    originalKind: 'image',
    downgraded: false,
    prompt: 'p',
    status: 'pending',
    attempts: 0,
    ...overrides
  };
}

async function flush() {
  await new Promise((r) => setTimeout(r, 200));
}

describe('queue-engine — video context as first chat message', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queueEngine.setBroadcaster(() => {});
    (tabManager.ensureProviderTab as any).mockResolvedValue(1);
    (tabManager.ping as any).mockResolvedValue({ ok: true, loggedIn: true });
    // Mặc định generate() trả lỗi KHÔNG retry được, để job kết thúc (failed) nhanh và batch
    // hoàn tất ngay — các test ở đây chỉ quan tâm bước gửi ngữ cảnh trước đó, không quan tâm
    // kết quả xử lý job.
    (tabManager.generate as any).mockResolvedValue({
      type: 'GENERATE_ERROR',
      requestId: 'x',
      ok: false,
      errorType: 'UNSUPPORTED',
      message: 'stop-here'
    });
  });

  it('does not call sendContext when videoContext is empty', async () => {
    await queueEngine.startBatch([makeJob()], makeConfig({ videoContext: '' }));
    await flush();
    expect(tabManager.sendContext).not.toHaveBeenCalled();
  });

  it('does not call sendContext when videoContext is only whitespace', async () => {
    await queueEngine.startBatch([makeJob()], makeConfig({ videoContext: '   ' }));
    await flush();
    expect(tabManager.sendContext).not.toHaveBeenCalled();
  });

  it('sends videoContext as the first message before running any job, and marks it sent', async () => {
    (tabManager.sendContext as any).mockResolvedValue({ type: 'CONTEXT_SENT', requestId: 'x', ok: true });

    await queueEngine.startBatch([makeJob()], makeConfig({ videoContext: 'Video về du lịch Đà Lạt' }));
    await flush();

    expect(tabManager.sendContext).toHaveBeenCalledTimes(1);
    expect(tabManager.sendContext).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ text: 'Video về du lịch Đà Lạt' }),
      expect.any(Number)
    );
    expect(queueEngine.getBatch()?.contextSent).toBe(true);

    // sendContext phải được gọi TRƯỚC generate() của job đầu tiên.
    const sendContextOrder = (tabManager.sendContext as any).mock.invocationCallOrder[0];
    const generateOrder = (tabManager.generate as any).mock.invocationCallOrder[0];
    expect(sendContextOrder).toBeLessThan(generateOrder);
  });

  it('halts the batch on RATE_LIMIT while sending context, without running any job', async () => {
    (tabManager.sendContext as any).mockResolvedValue({
      type: 'CONTEXT_SENT',
      requestId: 'x',
      ok: false,
      errorType: 'RATE_LIMIT',
      message: 'limited'
    });

    await queueEngine.startBatch([makeJob()], makeConfig({ videoContext: 'context' }));
    await flush();

    expect(queueEngine.getBatch()?.status).toBe('stopped_rate_limit');
    expect(queueEngine.getBatch()?.contextSent).toBeFalsy();
    expect(tabManager.generate).not.toHaveBeenCalled();
  });

  it('warns and still runs the batch (does not halt) on a non-session error like SELECTOR_MISS', async () => {
    (tabManager.sendContext as any).mockResolvedValue({
      type: 'CONTEXT_SENT',
      requestId: 'x',
      ok: false,
      errorType: 'SELECTOR_MISS',
      message: 'no input found'
    });

    await queueEngine.startBatch([makeJob()], makeConfig({ videoContext: 'context' }));
    await flush();

    expect(queueEngine.getBatch()?.contextSent).toBe(true); // đã thử, không lặp lại lỗi này nữa
    expect(tabManager.generate).toHaveBeenCalledTimes(1); // batch vẫn chạy tiếp, không bị chặn
  });

  it('does not resend context on resume once already sent', async () => {
    (tabManager.sendContext as any).mockResolvedValue({ type: 'CONTEXT_SENT', requestId: 'x', ok: true });
    (tabManager.generate as any).mockResolvedValueOnce({
      type: 'GENERATE_ERROR',
      requestId: 'x',
      ok: false,
      errorType: 'NOT_LOGGED_IN',
      message: 'expired'
    });

    await queueEngine.startBatch([makeJob()], makeConfig({ videoContext: 'context' }));
    await flush();
    expect(tabManager.sendContext).toHaveBeenCalledTimes(1);
    expect(queueEngine.getBatch()?.status).toBe('needs_attention');

    await queueEngine.resumeBatch();
    await flush();
    expect(tabManager.sendContext).toHaveBeenCalledTimes(1); // vẫn 1 — không gửi lại khi resume
  });
});

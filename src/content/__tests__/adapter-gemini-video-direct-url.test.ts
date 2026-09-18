// Regression test cho phát hiện thật: <video>.currentSrc của Gemini là URL tải trực tiếp
// thật (không phải blob:), dạng contribution.usercontent.google.com/download?...&filename=
// video.mp4 — tải thẳng qua URL này, không cần bấm nút "Download video" (đã xác nhận nút tải
// ảnh giả lập không kích hoạt được download thật, nghi cùng cơ chế event.isTrusted áp dụng
// cho video).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GeminiAdapter } from '../adapter-gemini';

// URL thật lấy từ soi DOM trên gemini.google.com sau khi 1 video tạo xong.
const REAL_GEMINI_VIDEO_SRC =
  'https://contribution.usercontent.google.com/download?c=CgxiYXJkX3N0b3JhZ2USUBINcmVzcG9uc2VfZGF0YRo_CjA2ZTlhNDE1OTFiODU1MDJmMDAwNjViYzVlMjRjYmUxYzAxNGIxZmIxOTcyN2ViYTMSCxIHEJfq0_CFERgB&filename=video.mp4&opi=103135050';

function makeDom() {
  document.body.innerHTML = `
    <div class="ql-editor" aria-label="Enter a prompt for Gemini" contenteditable="true"></div>
    <button aria-label="Send message"></button>
  `;
}

describe('GeminiAdapter.generate(kind: "video") — direct URL vs blob: fallback', () => {
  beforeEach(() => {
    makeDom();
    vi.useFakeTimers();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('uses <video>.currentSrc directly (no download-button click) when it is a real https URL', async () => {
    const adapter = new GeminiAdapter();
    const controller = new AbortController();

    const pending = adapter.generate({
      requestId: 'req-video-direct-1',
      prompt: 'Tạo video: cảnh hoàng hôn trên biển',
      kind: 'video',
      aspectRatio: '16:9',
      signal: controller.signal
    });

    await vi.advanceTimersByTimeAsync(20_500);

    const newTurn = document.createElement('div');
    newTurn.setAttribute('data-test-id', 'conversation-turn');
    const video = document.createElement('video');
    video.setAttribute('src', REAL_GEMINI_VIDEO_SRC); // để khớp selector resultVideo 'video[src]'
    // jsdom không tự tính currentSrc từ thuộc tính src (không có network thật) nên gán trực
    // tiếp để mô phỏng đúng trạng thái trình duyệt thật sau khi video đã load.
    Object.defineProperty(video, 'currentSrc', { value: REAL_GEMINI_VIDEO_SRC, configurable: true });
    newTurn.appendChild(video);
    document.body.appendChild(newTurn);

    await vi.advanceTimersByTimeAsync(1_000);

    const outcome = await pending;

    expect(outcome.captureMode).toBe('url');
    expect(outcome.mediaType).toBe('mp4');
    expect(outcome.mediaUrl).toBe(REAL_GEMINI_VIDEO_SRC);
  }, 10_000);

  it('falls back to fetching+base64 when currentSrc is a blob: URL (cannot be downloaded directly from the background)', async () => {
    const adapter = new GeminiAdapter();
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ blob: async () => new Blob(['x'], { type: 'video/mp4' }) }));

    const pending = adapter.generate({
      requestId: 'req-video-direct-2',
      prompt: 'Tạo video: cảnh núi rừng',
      kind: 'video',
      aspectRatio: '16:9',
      signal: controller.signal
    });

    await vi.advanceTimersByTimeAsync(20_500);

    const newTurn = document.createElement('div');
    newTurn.setAttribute('data-test-id', 'conversation-turn');
    const video = document.createElement('video');
    video.setAttribute('src', 'blob:https://gemini.google.com/abc-123');
    Object.defineProperty(video, 'currentSrc', { value: 'blob:https://gemini.google.com/abc-123', configurable: true });
    newTurn.appendChild(video);
    document.body.appendChild(newTurn);

    await vi.advanceTimersByTimeAsync(1_000);

    const outcome = await pending;

    expect(outcome.captureMode).toBe('url');
    expect(outcome.mediaType).toBe('mp4');
    expect(outcome.mediaUrl.startsWith('data:video/mp4')).toBe(true);

    vi.unstubAllGlobals();
  }, 10_000);
});

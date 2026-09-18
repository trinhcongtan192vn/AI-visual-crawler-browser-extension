// Regression test cho bug thật: nút "Download full size image" của Gemini không tải được
// gì khi bấm bằng dispatchEvent (xác nhận qua chrome://downloads — không có file nào xuất
// hiện dù Gemini báo "đã tải"), nghi do trang kiểm tra event.isTrusted. Sửa: lấy thẳng ảnh
// gốc qua URL bằng cách đổi hậu tố kích thước "=s1024-rj" -> "=s0" (quy ước Google) trên
// chính <img src>, không cần bấm nút nào cả.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GeminiAdapter } from '../adapter-gemini';

// URL thật lấy từ soi DOM trên gemini.google.com (đã rút gọn token cho gọn, giữ nguyên cấu trúc).
const REAL_GEMINI_IMG_SRC =
  'https://lh3.googleusercontent.com/gg/ACRwjatceXPIs66vqB_WJX0sjtAh13K8yAsGiNV3Q5InYX3R7iKHDsXQLCb5wn=s1024-rj';

describe('GeminiAdapter — full-size image via URL (no button click needed)', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div class="ql-editor" aria-label="Enter a prompt for Gemini" contenteditable="true"></div>
      <button aria-label="Send message"></button>
    `;
    vi.useFakeTimers();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('rewrites the googleusercontent size suffix (=s1024-rj) to =s0 (original size) and returns it directly, without registering any download-button click', async () => {
    const adapter = new GeminiAdapter();
    const controller = new AbortController();

    const pending = adapter.generate({
      requestId: 'req-fullsize-1',
      prompt: 'a cat',
      kind: 'image',
      aspectRatio: '16:9',
      signal: controller.signal
    });

    await vi.advanceTimersByTimeAsync(20_500);

    const newTurn = document.createElement('div');
    newTurn.setAttribute('data-test-id', 'conversation-turn');
    newTurn.innerHTML = `<generated-image><img src="${REAL_GEMINI_IMG_SRC}" /></generated-image>`;
    document.body.appendChild(newTurn);

    await vi.advanceTimersByTimeAsync(1_000);

    const outcome = await pending;

    expect(outcome.captureMode).toBe('url');
    expect(outcome.mediaUrl).toBe(
      'https://lh3.googleusercontent.com/gg/ACRwjatceXPIs66vqB_WJX0sjtAh13K8yAsGiNV3Q5InYX3R7iKHDsXQLCb5wn=s0'
    );
  }, 10_000);

  it('falls back to normal handling (download button / raw <img src> fetch) for a non-googleusercontent image URL', async () => {
    const adapter = new GeminiAdapter();
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ blob: async () => new Blob(['x'], { type: 'image/png' }) }));

    const pending = adapter.generate({
      requestId: 'req-fullsize-2',
      prompt: 'a dog',
      kind: 'image',
      aspectRatio: '16:9',
      signal: controller.signal
    });

    await vi.advanceTimersByTimeAsync(20_500);

    const newTurn = document.createElement('div');
    newTurn.setAttribute('data-test-id', 'conversation-turn');
    newTurn.innerHTML = '<generated-image><img src="https://example.com/some-other-image.png" /></generated-image>';
    document.body.appendChild(newTurn);

    await vi.advanceTimersByTimeAsync(1_000);

    const outcome = await pending;
    // Không có nút tải trong DOM giả lập -> rơi xuống fetch <img src> nguyên bản (không đổi URL).
    expect(outcome.captureMode).toBe('url');
    expect(outcome.mediaUrl.startsWith('data:image/png')).toBe(true);

    vi.unstubAllGlobals();
  }, 10_000);
});

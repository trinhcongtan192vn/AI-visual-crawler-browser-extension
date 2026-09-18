// Regression test cho phản hồi thực tế của user: tạo video trên Gemini KHÔNG cần chọn model
// (không có bước mở dropdown/chọn "Veo" riêng như PRD ban đầu giả định) — chỉ cần đúng nội
// dung prompt (video template) là đủ. Test này xác nhận generate(kind:'video') chạy trọn vẹn
// dù trang KHÔNG có bất kỳ phần tử "chọn model" nào trong DOM.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GeminiAdapter } from '../adapter-gemini';

describe('GeminiAdapter.generate(kind: "video") — no model-picker interaction at all', () => {
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

  it('generates a video without ever looking for a model switcher/Veo option in the DOM', async () => {
    const adapter = new GeminiAdapter();
    const controller = new AbortController();

    const pending = adapter.generate({
      requestId: 'req-video-1',
      prompt: 'Chuyển động máy quay chậm, phong cách điện ảnh',
      kind: 'video',
      aspectRatio: '16:9',
      signal: controller.signal
    });

    await vi.advanceTimersByTimeAsync(20_500);

    const newTurn = document.createElement('div');
    newTurn.setAttribute('data-test-id', 'conversation-turn');
    newTurn.innerHTML = '<video src="https://example.com/rendered.mp4"></video>';
    document.body.appendChild(newTurn);

    await vi.advanceTimersByTimeAsync(1_000);

    const outcome = await pending;

    expect(outcome.mediaType).toBe('mp4');
    expect(outcome.captureMode).toBe('url');
    expect(outcome.mediaUrl).toBe('https://example.com/rendered.mp4');
    // Không có nút/dropdown chọn model nào từng được thêm vào DOM giả lập ở trên, và
    // generate() vẫn thành công -> xác nhận không có bước nào phụ thuộc vào phần tử đó.
  }, 10_000);
});

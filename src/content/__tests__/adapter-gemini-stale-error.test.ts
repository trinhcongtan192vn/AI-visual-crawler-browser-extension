// Regression test cho bug thật: block trước lỗi (VD video hết quota) để lại thông báo lỗi
// vẫn còn trên trang; block SAU đó dù thành công vẫn bị báo PROVIDER_ERROR sai vì code quét
// lỗi trên TOÀN TRANG thay vì chỉ trong turn mới nhất. Sửa: markerPresent(errorMarker/
// rateLimitMarker) giờ được scope vào đúng newestTurn trong waitForDone().
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GeminiAdapter } from '../adapter-gemini';

describe('GeminiAdapter — a stale error from a previous turn must not fail a later successful block', () => {
  beforeEach(() => {
    // Mô phỏng đúng hiện trạng trang SAU KHI block trước (video) đã lỗi: thông báo lỗi vẫn
    // còn nằm trong lịch sử chat (turn cũ), không bị dọn đi.
    document.body.innerHTML = `
      <div class="ql-editor" aria-label="Enter a prompt for Gemini" contenteditable="true"></div>
      <button aria-label="Send message"></button>
      <div data-test-id="conversation-turn">
        <p>unable to generate video — quota exceeded</p>
      </div>
    `;
    vi.useFakeTimers();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('generates the image successfully even though an old error message is still present elsewhere on the page', async () => {
    const adapter = new GeminiAdapter();
    const controller = new AbortController();

    const pending = adapter.generate({
      requestId: 'req-b02',
      prompt: 'a cat',
      kind: 'image',
      aspectRatio: '16:9',
      signal: controller.signal
    });

    await vi.advanceTimersByTimeAsync(20_500);

    // Turn MỚI của block này thành công — không có lỗi gì trong chính turn mới.
    const newTurn = document.createElement('div');
    newTurn.setAttribute('data-test-id', 'conversation-turn');
    newTurn.innerHTML = '<generated-image><img src="https://lh3.googleusercontent.com/gg/fresh=s1024-rj" /></generated-image>';
    document.body.appendChild(newTurn);

    await vi.advanceTimersByTimeAsync(1_000);

    const outcome = await pending;

    expect(outcome.captureMode).toBe('url');
    expect(outcome.mediaUrl).toBe('https://lh3.googleusercontent.com/gg/fresh=s0');
  }, 10_000);
});

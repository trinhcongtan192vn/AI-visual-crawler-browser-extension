// Regression test cho bug thật: ChatGPT tạo ảnh xong nhưng adapter timeout không thấy —
// nguyên nhân là dựa vào turnContainer (selector không đáng tin trên ChatGPT hiện tại).
// Sửa: nhận diện ảnh mới bằng cách so sánh tập src ảnh trước/sau khi gửi (không cần biết
// đúng cấu trúc container). Test này mô phỏng đúng kịch bản: đã có 1 ảnh CŨ trong hội thoại
// trước khi generate() chạy, rồi 1 ảnh MỚI xuất hiện sau — adapter phải lấy đúng ảnh mới,
// không lấy nhầm ảnh cũ (và không bị chặn vì "không thấy turn mới" như code cũ).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatGptAdapter } from '../adapter-chatgpt';

function makeBlobResponse(): Response {
  return {
    blob: async () => new Blob(['fake-image-bytes'], { type: 'image/png' })
  } as unknown as Response;
}

describe('ChatGptAdapter.generate — image detection without a reliable turnContainer', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="prompt-textarea" contenteditable="true" aria-label="Chat with ChatGPT"></div>
      <button data-testid="send-button" aria-label="Send prompt"></button>
      <img src="https://chatgpt.com/backend-api/estuary/content?id=file_OLD" />
    `;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeBlobResponse()));
    vi.useFakeTimers();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('picks the newly appeared image, not the pre-existing one already in the DOM', async () => {
    const adapter = new ChatGptAdapter();
    const controller = new AbortController();

    const pending = adapter.generate({
      requestId: 'req-1',
      prompt: 'a cat',
      kind: 'image',
      aspectRatio: '16:9',
      signal: controller.signal
    });

    // Lướt qua đúng nhịp chờ generatingMarker (best-effort, 20s) như hành vi thật — không có
    // generatingMarker trong DOM giả lập nên nó sẽ timeout và tiếp tục, y hệt log thật đã thấy.
    await vi.advanceTimersByTimeAsync(20_500);

    // Giờ mô phỏng ChatGPT vừa render xong ảnh mới.
    const img = document.createElement('img');
    img.src = 'https://chatgpt.com/backend-api/estuary/content?id=file_NEW';
    document.body.appendChild(img);

    // Đủ để vòng poll (300ms) tiếp theo của waitFor bắt được ảnh mới.
    await vi.advanceTimersByTimeAsync(1_000);

    const outcome = await pending;

    expect(outcome.mediaType).toBe('png');
    expect(outcome.captureMode).toBe('url'); // không có downloadButton trong DOM giả lập -> fallback img src
    expect(outcome.mediaUrl.startsWith('data:image/png')).toBe(true);
  }, 10_000);

  it('throws TIMEOUT (not silently hangs forever) if no new image ever appears', async () => {
    const adapter = new ChatGptAdapter();
    const controller = new AbortController();

    const pending = adapter.generate({
      requestId: 'req-2',
      prompt: 'a dog',
      kind: 'image',
      aspectRatio: '16:9',
      signal: controller.signal
    });
    // Không có ảnh mới nào được thêm vào DOM — chỉ ảnh CŨ tồn tại sẵn.

    const assertion = expect(pending).rejects.toMatchObject({ errorType: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(150_000);
    await assertion;
  }, 10_000);
});

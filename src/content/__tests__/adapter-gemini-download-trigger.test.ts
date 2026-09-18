// Regression test cho bug thật: ảnh thứ 2 trở đi báo "DOWNLOAD_FAILED: Không bắt được file
// trang tự tải trong thời gian chờ" dù generate() báo thành công. Nguyên nhân nghi vấn: nút
// tải được TÌM THẤY lúc generate() chạy, nhưng chỉ thực sự được BẤM sau một round-trip
// message riêng (TRIGGER_DOWNLOAD, do worker phải "vũ trang" onDeterminingFilename trước).
// Trong khoảng trễ đó, nếu Angular (framework của Gemini) render lại DOM và thay node cũ
// bằng node mới, tham chiếu cũ dùng humanClick() sẽ nhắm vào phần tử đã "chết" (detached),
// click không tác dụng, không có download nào được tạo ra -> đúng triệu chứng "timeout im lặng".
// Sửa: đăng ký callback TÌM LẠI phần tử tại thời điểm bấm, không dùng closure đã capture sẵn.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GeminiAdapter } from '../adapter-gemini';
import { firePendingDownloadTrigger } from '../dom-utils';

describe('GeminiAdapter — download button re-resolved fresh at trigger time (not a stale reference)', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div class="ql-editor" aria-label="Enter a prompt for Gemini" contenteditable="true"></div>
      <button aria-label="Send message"></button>
      <div data-test-id="conversation-turn">
        <generated-image><img src="https://old-turn-img" /></generated-image>
        <button aria-label="Download full size image" id="old-btn"></button>
      </div>
    `;
    vi.useFakeTimers();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('clicks the button currently in the live DOM at trigger time, even if the node found during generate() was since replaced', async () => {
    const adapter = new GeminiAdapter();
    const controller = new AbortController();

    const pending = adapter.generate({
      requestId: 'req-stale-1',
      prompt: 'a mountain landscape',
      kind: 'image',
      aspectRatio: '16:9',
      signal: controller.signal
    });

    // Lướt qua nhịp chờ generatingMarker (best-effort, 20s) như hành vi thật.
    await vi.advanceTimersByTimeAsync(20_500);

    // Gemini "render xong" turn mới cho block này.
    const newTurn = document.createElement('div');
    newTurn.setAttribute('data-test-id', 'conversation-turn');
    newTurn.innerHTML = '<generated-image><img src="https://new-turn-img" /></generated-image>';
    const originalBtn = document.createElement('button');
    originalBtn.setAttribute('aria-label', 'Download full size image');
    originalBtn.id = 'original-btn';
    newTurn.appendChild(originalBtn);
    document.body.appendChild(newTurn);

    await vi.advanceTimersByTimeAsync(1_000);

    const outcome = await pending;
    expect(outcome.captureMode).toBe('page-triggered');

    // Mô phỏng Angular render lại: gỡ nút đã tìm được, thay bằng một nút MỚI (cùng selector,
    // khác định danh) — đúng kịch bản làm tham chiếu cũ "chết" trước khi TRIGGER_DOWNLOAD tới.
    let originalClicked = false;
    let replacementClicked = false;
    originalBtn.addEventListener('click', () => {
      originalClicked = true;
    });

    const replacementBtn = document.createElement('button');
    replacementBtn.setAttribute('aria-label', 'Download full size image');
    replacementBtn.id = 'replacement-btn';
    replacementBtn.addEventListener('click', () => {
      replacementClicked = true;
    });
    newTurn.replaceChild(replacementBtn, originalBtn);

    const fired = firePendingDownloadTrigger('req-stale-1');
    expect(fired).toBe(true);

    expect(replacementClicked).toBe(true);
    expect(originalClicked).toBe(false);
  }, 10_000);
});

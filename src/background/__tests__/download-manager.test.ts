// Regression test cho bug thật: "DOWNLOAD_FAILED: Không bắt được file trang tự tải trong
// thời gian chờ" dù Gemini báo đã tải ảnh xong. Nguyên nhân: Gemini cần vài giây chuẩn bị
// ảnh full-size ở SERVER trước khi download thật sự bắt đầu (bấm nút không tải ngay lập
// tức) — timeout cũ (20s) tắt lắng nghe TRƯỚC KHI download thật sự khởi động. Đã tăng lên 60s.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

function createDownloadsMock() {
  const createdListeners: Array<(item: { id: number }) => void> = [];
  const changedListeners: Array<(delta: { id: number; state?: { current: string } }) => void> = [];
  const determiningListeners: Array<(item: unknown, suggest: (o: unknown) => void) => void> = [];
  return {
    download: vi.fn(),
    onCreated: {
      addListener: (fn: (item: { id: number }) => void) => createdListeners.push(fn),
      removeListener: (fn: (item: { id: number }) => void) => {
        const i = createdListeners.indexOf(fn);
        if (i >= 0) createdListeners.splice(i, 1);
      }
    },
    onChanged: {
      addListener: (fn: (delta: { id: number; state?: { current: string } }) => void) => changedListeners.push(fn),
      removeListener: (fn: (delta: { id: number; state?: { current: string } }) => void) => {
        const i = changedListeners.indexOf(fn);
        if (i >= 0) changedListeners.splice(i, 1);
      }
    },
    onDeterminingFilename: {
      addListener: (fn: (item: unknown, suggest: (o: unknown) => void) => void) => determiningListeners.push(fn)
    },
    __fireCreated(item: { id: number }) {
      createdListeners.slice().forEach((fn) => fn(item));
    },
    __fireChanged(delta: { id: number; state?: { current: string } }) {
      changedListeners.slice().forEach((fn) => fn(delta));
    },
    __fireDetermining(item: unknown): unknown {
      let suggestion: unknown;
      determiningListeners.slice().forEach((fn) => fn(item, (o: unknown) => (suggestion = o)));
      return suggestion;
    }
  };
}

let downloadManager: typeof import('../download-manager');
let downloadsMock: ReturnType<typeof createDownloadsMock>;

beforeAll(async () => {
  downloadsMock = createDownloadsMock();
  (globalThis as any).chrome = { ...(globalThis as any).chrome, downloads: downloadsMock };
  downloadManager = await import('../download-manager');
});

beforeEach(() => {
  vi.useFakeTimers();
});

describe('captureNextPageTriggeredDownload', () => {
  it('still captures the download when it only starts ~35s after being triggered (Gemini prepares full-size image server-side first)', async () => {
    const triggerDownload = vi.fn(async () => {
      // Click đã gửi đi — nhưng download THẬT chỉ xuất hiện sau một khoảng trễ dài do
      // Gemini xử lý ở server, không phải ngay lập tức.
    });

    const promise = downloadManager.captureNextPageTriggeredDownload('B01.png', 'folder', triggerDownload, 60_000);

    await vi.advanceTimersByTimeAsync(35_000);
    downloadsMock.__fireCreated({ id: 501 });
    await vi.advanceTimersByTimeAsync(100);
    downloadsMock.__fireChanged({ id: 501, state: { current: 'complete' } });

    const result = await promise;
    expect(result).toBe('B01.png');
  });

  it('regression proof: the OLD 20s timeout would have missed this exact same late download', async () => {
    const triggerDownload = vi.fn(async () => {});

    const promise = downloadManager.captureNextPageTriggeredDownload('B01.png', 'folder', triggerDownload, 20_000);
    const assertion = expect(promise).rejects.toThrow(/Không bắt được file/);

    await vi.advanceTimersByTimeAsync(35_000); // download vẫn chưa tới lúc timeout 20s cũ đã hết hạn
    downloadsMock.__fireCreated({ id: 502 }); // tới quá muộn, timeout đã hủy lắng nghe từ trước

    await assertion;
  });
});

describe('saveByUrl', () => {
  // Regression thật: gọi chrome.downloads.download({filename: "..."}) TRỰC TIẾP không đủ —
  // xác nhận qua debug tay: Chrome bỏ qua filename mình truyền, tự lấy tên theo gợi ý của
  // server (VD "video.mp4" từ URL) và lưu ra gốc Downloads. Lý do: bản thân việc có đăng ký
  // onDeterminingFilename listener khiến Chrome không còn tự dùng `filename` option nữa nếu
  // listener đó im lặng. Phải chủ động gọi suggest() với đúng tên/folder — test dưới xác nhận
  // saveByUrl() luôn làm vậy, không dựa vào Chrome tự tôn trọng option `filename`.
  it('explicitly claims the filename via onDeterminingFilename suggest(), not just the download() filename option', async () => {
    downloadsMock.download.mockImplementation(async () => 42);

    const promise = downloadManager.saveByUrl('https://example.com/video.mp4?filename=video.mp4', 'B01.mp4', 'YT_Visuals_test');

    // Mô phỏng Chrome gọi onDeterminingFilename cho đúng download này (item.id không quan
    // trọng với listener hiện tại vì nó chỉ dựa vào cờ expectingCapture, không lọc theo id).
    const suggestion = downloadsMock.__fireDetermining({ id: 42, filename: 'video.mp4' });
    expect(suggestion).toEqual({ filename: 'YT_Visuals_test/B01.mp4', conflictAction: 'uniquify' });

    // Để saveByUrl() thực sự chạy qua được await download() (mock async) và đăng ký xong
    // listener onChanged bên trong waitDownloadComplete, trước khi mình bắn sự kiện 'complete'.
    await vi.advanceTimersByTimeAsync(0);
    downloadsMock.__fireChanged({ id: 42, state: { current: 'complete' } });
    const result = await promise;
    expect(result).toBe('B01.mp4');
  });

  it('resets the capture flag even if the download itself fails, so a later unrelated download is not hijacked', async () => {
    downloadsMock.download.mockImplementation(async () => 43);

    const promise = downloadManager.saveByUrl('https://example.com/broken.mp4', 'B02.mp4', 'folder');
    await vi.advanceTimersByTimeAsync(0);
    downloadsMock.__fireChanged({ id: 43, state: { current: 'interrupted' } });
    await expect(promise).rejects.toThrow();

    // Sau khi saveByUrl() thất bại, một download KHÔNG LIÊN QUAN (VD người dùng tự tải tay)
    // không được ăn theo tên/folder cũ còn sót lại.
    const suggestion = downloadsMock.__fireDetermining({ id: 999, filename: 'unrelated.png' });
    expect(suggestion).toBeUndefined();
  });
});

# 06 — Provider Adapters (content script)

**Đây là phần dễ vỡ nhất của toàn hệ thống.** DOM của ChatGPT/Gemini đổi thường xuyên.
Nguyên tắc: mọi selector và bước thao tác DOM khu trú ở đây; logic điều phối (05) không biết gì.

Files: `content-entry.ts`, `adapter-base.ts`, `adapter-chatgpt.ts`, `adapter-gemini.ts`,
`selectors.ts`, `dom-utils.ts`.

## 6.1 Interface chung (`adapter-base.ts`)

```ts
export interface ProviderAdapter {
  provider: Provider;
  isLoggedIn(): boolean;
  /** Thực hiện 1 lần tạo, trả media URL để worker tải. Throw AdapterError khi lỗi. */
  generate(req: {
    prompt: string;
    kind: ResolvedKind;
    aspectRatio: AspectRatio;
    signal: AbortSignal;      // để ABORT
  }): Promise<{ mediaUrl: string; mediaType: 'png' | 'mp4' }>;
}

export class AdapterError extends Error {
  constructor(public errorType: ErrorType, message: string) { super(message); }
}
```

`content-entry.ts`:
- Xác định provider theo `location.host`.
- Khởi tạo adapter tương ứng.
- Lắng nghe message từ worker (`PING`, `GENERATE`, `ABORT`), gọi adapter, map kết quả/exception
  về `GENERATE_RESULT` / `GENERATE_ERROR`. `AdapterError.errorType` → `errorType` trả về.
- Giữ `Map<requestId, AbortController>` để ABORT.

## 6.2 Selector profiles (`selectors.ts`) — CÓ THỂ VÁ KHÔNG CẦN BUILD

Tách toàn bộ selector ra một object versioned. Cho phép override từ `chrome.storage.local`
(key `SELECTOR_OVERRIDES`) để vá nóng khi trang đổi, không cần build lại.

```ts
export interface SelectorProfile {
  version: string;
  chatgpt: {
    promptInput: string[];        // danh sách fallback, thử lần lượt
    sendButton: string[];
    // ảnh sinh ra trong luồng chat:
    resultImage: string[];        // <img> kết quả trong turn mới nhất
    downloadButton: string[];     // nút tải chuyên dụng (nếu có)
    loggedOutMarker: string[];    // dấu hiệu chưa đăng nhập
    rateLimitMarker: string[];    // text/element báo hết lượt
    errorMarker: string[];        // thông báo lỗi nội dung
    generatingMarker: string[];   // dấu hiệu đang chạy (spinner/stop button)
  };
  gemini: {
    promptInput: string[];
    sendButton: string[];
    modelSwitcher: string[];      // mở dropdown model
    veoOption: string[];          // chọn model tạo video (Veo)
    imageModelOption: string[];   // model tạo ảnh (nếu cần chọn)
    resultImage: string[];
    resultVideo: string[];        // <video> hoặc container video
    imageDownloadButton: string[];
    videoDownloadButton: string[];
    loggedOutMarker: string[];
    rateLimitMarker: string[];
    errorMarker: string[];
    generatingMarker: string[];
  };
}

// Giá trị mặc định: điền bằng selector quan sát tại thời điểm implement.
// LƯU Ý: đây là ước lượng, PHẢI kiểm chứng trực tiếp trên trang khi code (xem 6.7).
export const DEFAULT_SELECTORS: SelectorProfile = { /* ... */ };
```

Runtime merge: `effectiveSelectors = deepMerge(DEFAULT_SELECTORS, storageOverrides)`.

## 6.3 DOM utils (`dom-utils.ts`)

Các primitive dùng lại, tất cả có timeout & abort:

```ts
// Thử từng selector tới khi thấy element hiển thị; trả element đầu tiên khớp.
export function queryFirst(selectors: string[]): HTMLElement | null;

// Chờ tới khi predicate true hoặc timeout. Poll ~300ms. Hủy khi signal abort.
export function waitFor<T>(
  fn: () => T | null,
  opts: { timeoutMs: number; signal: AbortSignal; pollMs?: number }
): Promise<T>;

// Nhập text an toàn cho contenteditable & textarea (set value + dispatch input events).
export function setPromptText(el: HTMLElement, text: string): void;

// Click "như người": scrollIntoView, dispatch pointer/mouse events.
export function humanClick(el: HTMLElement): void;

export function sleep(ms: number, signal?: AbortSignal): Promise<void>;
```

`setPromptText` lưu ý: nhiều editor (ProseMirror/Lexical) không nhận `el.value=...`.
Phải dispatch `beforeinput`/`input` hoặc dùng `document.execCommand('insertText')` fallback,
rồi verify nội dung đã vào ô trước khi bấm gửi.

## 6.4 Adapter ChatGPT (`adapter-chatgpt.ts`) — chỉ ẢNH

Luồng `generate` (kind luôn là `image`; nếu nhận `video` → throw `UNSUPPORTED`
vì downgrade đã xử lý ở worker, đây chỉ là chốt chặn):

1. `isLoggedIn()`: không thấy `loggedOutMarker` và có `promptInput`.
2. Đợi `promptInput`, `setPromptText(prompt)`.
   - Nếu muốn ép tỷ lệ: chèn hint tỷ lệ vào prompt (ChatGPT không có control tỷ lệ UI ổn định).
3. `humanClick(sendButton)` (hoặc Enter nếu không có nút rõ ràng).
4. Chờ bắt đầu chạy: xuất hiện `generatingMarker`; rồi chờ **kết thúc**: `generatingMarker`
   biến mất VÀ `resultImage` xuất hiện trong turn mới nhất. Timeout ảnh (xem 09).
5. Trong lúc chờ, poll `rateLimitMarker` / `errorMarker`:
   - thấy rate limit → throw `AdapterError('RATE_LIMIT')`.
   - thấy lỗi nội dung → throw `AdapterError('PROVIDER_ERROR', <text>)`.
6. Lấy media URL:
   - Ưu tiên `downloadButton` nếu có (cho file gốc). Nếu nút tải kích hoạt tải trực tiếp
     của trình duyệt thay vì cho URL, xem 6.6 "Lấy file khi chỉ có nút tải".
   - Nếu chỉ có `<img>`: lấy `src`. Cảnh báo chất lượng (6.6).
7. Trả `{ mediaUrl, mediaType: 'png' }`.

## 6.5 Adapter Gemini (`adapter-gemini.ts`) — ẢNH + VIDEO (Veo)

`generate`:
1. `isLoggedIn()` tương tự.
2. **Chọn model theo kind** (khác ChatGPT):
   - `kind==='video'`: mở `modelSwitcher`, chọn `veoOption`. Xác nhận model đã chuyển
     (kiểm tra nhãn model hiển thị) trước khi tiếp.
   - `kind==='image'`: đảm bảo đang ở model có khả năng tạo ảnh (chọn `imageModelOption`
     nếu cần). Nếu model mặc định đã tạo ảnh được thì bỏ qua bước này.
3. Đặt tỷ lệ khung hình nếu UI có control (một số phiên bản Veo có chọn 16:9 / 9:16).
   Nếu không có control → chèn hint tỷ lệ vào prompt.
4. `setPromptText(prompt)` → `humanClick(sendButton)`.
5. Chờ kết thúc:
   - ảnh: như ChatGPT (resultImage xuất hiện).
   - video: chờ `resultVideo` sẵn sàng + nút tải video xuất hiện. **Timeout dài** (video
     render lâu — vài phút). Poll trạng thái, đừng await một promise dài (phối hợp keepalive 05).
6. Poll rate limit/error song song (Veo có hạn mức video/tháng → `rateLimitMarker` hoặc
   thông báo hết lượt riêng cho video → `RATE_LIMIT`).
7. Lấy media URL:
   - ảnh: `imageDownloadButton` (ưu tiên, để lấy full-res) hoặc `<img src>`.
   - video: `videoDownloadButton` hoặc `<video src>` / nguồn blob (6.6).
8. Trả `{ mediaUrl, mediaType: 'png'|'mp4' }`.

## 6.6 Lấy file đúng cách (quan trọng cho chất lượng)

**Vấn đề đã xác nhận:** với ảnh Gemini, chuột phải "Save image as" hoặc lấy `<img src>`
hiển thị có thể chỉ ra **bản preview nén độ phân giải thấp**, không phải file gốc. File gốc
lấy qua **nút Download chuyên dụng** khi hover ảnh.

Chiến lược lấy file, theo thứ tự ưu tiên:

1. **Đọc URL từ nút/thẻ tải chuyên dụng.** Nếu nút tải là `<a href>` → lấy `href` (URL gốc),
   trả cho worker để `chrome.downloads.download` (đặt tên chuẩn). Đây là đường lý tưởng.
2. **Nút tải kích hoạt download của trình duyệt (không phải href).** Hai lựa chọn:
   - a) Để nút tự tải, rồi worker "nhận" file qua `chrome.downloads.onCreated`/`onDeterminingFilename`
     và **đổi tên** theo quy ước (xem 07 mục "Bắt file do trang tự tải").
   - b) Nếu content script bấm nút nhưng cần tên chuẩn ngay, ưu tiên đường (a) vì đáng tin hơn.
3. **Chỉ có `<img src>` / `<video src>` blob:** fetch trong content script
   (`fetch(src).then(r=>r.blob())`), chuyển blob→data URL, gửi cho worker tải.
   Với ảnh: chấp nhận rủi ro preview-nén; ghi log cảnh báo. Với video blob-URL: fetch blob rồi
   chuyển data URL (chú ý video lớn — cân nhắc truyền qua `chrome.downloads` bằng blob URL tạo
   ở worker; nếu blob thuộc content-script context thì phải chuyển data/objectURL cẩn thận).

> Khuyến nghị mặc định: **đường 1** nếu có href; nếu không, **đường 2a** (để trang tải,
> worker đổi tên). Chỉ dùng đường 3 khi hai cách trên bất khả thi.

## 6.7 Bắt buộc khi implement: xác minh selector thật

DEFAULT_SELECTORS chỉ là điểm khởi đầu. Khi code, PHẢI mở trang thật và:
- Xác định selector ổn định (ưu tiên `data-*`, `aria-label`, role; tránh class hash ngẫu nhiên).
- Ghi **nhiều fallback** mỗi vai trò (mảng selectors).
- Ghi lại `version` + ngày kiểm chứng trong `selectors.ts`.
- Viết một trang test thủ công: chạy `generate` cho 1 prompt ảnh và (Gemini) 1 prompt video,
  log từng bước pass/fail để dễ khoanh vùng khi vỡ.

## 6.8 Chống nhầm turn

Trang là hội thoại nhiều lượt. Adapter phải chỉ đọc **kết quả của turn vừa gửi**, không phải
ảnh cũ phía trên. Cách làm:
- Trước khi gửi, đếm số message/turn hiện có (hoặc ghi nhớ node cuối).
- Sau khi gửi, chỉ tìm `resultImage/resultVideo` **trong turn mới xuất hiện** sau mốc đó.
- Nếu không phân biệt được turn, dùng MutationObserver theo container hội thoại để bắt node mới.

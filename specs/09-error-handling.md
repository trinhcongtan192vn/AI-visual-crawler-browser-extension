# 09 — Error Handling, Timeouts, Detection

## 9.1 Phân loại lỗi (ErrorType)

| ErrorType | Nguồn | Cấp độ | Xử lý |
|-----------|-------|--------|-------|
| `RATE_LIMIT` | content script (DOM marker) / fallback worker | phiên | dừng batch → `stopped_rate_limit`, job về pending |
| `NOT_LOGGED_IN` | content script | phiên | dừng batch → `needs_attention` |
| `TIMEOUT` | worker (chờ generate) / adapter | block | auto-retry ≤2, rồi `failed` |
| `SELECTOR_MISS` | adapter (không thấy element cần) | block | auto-retry ≤2, rồi `failed` |
| `PROVIDER_ERROR` | content script (trang báo lỗi nội dung/từ chối prompt) | block | auto-retry ≤2, rồi `failed` |
| `DOWNLOAD_FAILED` | download manager | block | auto-retry ≤2, rồi `failed` |
| `UNSUPPORTED` | adapter (VD video trên ChatGPT lọt tới đây) | block | `failed` ngay, không retry |
| `UNKNOWN` | mọi nơi | block | auto-retry ≤2, rồi `failed` |

Phân biệt **phiên** vs **block** quyết định dừng cả batch hay chỉ bỏ 1 block (xem 05).

## 9.2 Timeouts (src/shared/constants.ts)

```ts
export const TIMEOUTS = {
  ping: 3_000,
  promptInputReady: 15_000,
  generationStart: 20_000,     // từ lúc gửi tới lúc thấy dấu hiệu "đang chạy"
  imageDone: 120_000,          // chờ ảnh xong
  videoDone: 360_000,          // chờ video Veo xong (render lâu) — có thể tăng
  downloadComplete: 60_000,
  pageTriggeredCapture: 20_000 // chờ bắt file do trang tự tải (07 đường B)
};
```

Timeout là điểm dễ sai: video render có thể vượt 6 phút tùy tải hệ thống. Cho `videoDone`
có thể cấu hình; và khi chờ video, adapter nên phân biệt "vẫn đang render" (còn spinner) với
"đã treo" (không còn dấu hiệu tiến triển) để tránh timeout oan — nếu còn `generatingMarker`,
gia hạn thêm một nhịp thay vì bỏ ngay.

## 9.3 Detect "render xong" (per provider)

Nguyên tắc chung: **hai điều kiện AND** — (a) dấu hiệu đang-chạy biến mất, (b) media kết quả
xuất hiện trong turn mới. Chỉ (b) không đủ (có thể là ảnh cũ); chỉ (a) không đủ (có thể lỗi).

- **ChatGPT ảnh:** `generatingMarker` (nút Stop / spinner) mất + `resultImage` mới có trong turn cuối.
- **Gemini ảnh:** tương tự.
- **Gemini video:** `resultVideo` (thẻ video có src / player) sẵn sàng + nút tải video hiện.
  Video thường có bước "đang tạo video…" riêng — chờ marker đó mất.

Dùng MutationObserver theo container hội thoại để phát hiện node mới thay vì poll mù khi có thể.

## 9.4 Detect rate limit

Content script poll song song khi đang chờ generate:
- `rateLimitMarker`: text kiểu "bạn đã đạt giới hạn", "try again later", "hết lượt tạo video
  tháng này", banner giới hạn. Gom nhiều biến thể (đa ngôn ngữ: user có thể để UI tiếng Việt/Anh).
- Với video Gemini: có thể có thông báo hết hạn mức video riêng — cũng map về `RATE_LIMIT`.

Fallback ở worker: nếu **N job liên tiếp** (VD 3) cùng `TIMEOUT`/`PROVIDER_ERROR` bất thường,
nghi ngờ bị chặn → chuyển `needs_attention` để user kiểm tra thủ công (an toàn hơn là cứ retry).

## 9.5 Detect chưa đăng nhập

- `loggedOutMarker`: nút "Đăng nhập"/"Sign in", redirect tới trang login, hoặc thiếu hẳn
  `promptInput` kèm dấu hiệu landing.
- Phát hiện ở `PING` (trước khi generate) và cả trong lúc generate (phiên hết hạn giữa chừng).

## 9.6 Prompt bị từ chối (safety refusal)

Nếu provider từ chối tạo (nội dung nhạy cảm) → `PROVIDER_ERROR` với message trích từ trang.
Auto-retry thường vô ích (sẽ từ chối lại) nhưng vẫn theo policy chung; sau khi `failed`, user
thấy message ở màn Run và có thể sửa prompt ở Preview rồi Retry. Cân nhắc: nếu message khớp
mẫu "từ chối" → giảm số retry xuống 0 để đỡ tốn thời gian (tùy chọn tối ưu, không bắt buộc v1).

## 9.7 Logging

- `logger.ts`: cấp `debug|info|warn|error`, prefix `[AVG][<module>]`.
- Content script log kèm provider + requestId + bước (chọn model / nhập prompt / chờ / lấy file)
  để khi vỡ biết chết ở đâu.
- Worker log mỗi chuyển trạng thái job + lý do halt batch.
- Không log nội dung nhạy cảm ngoài prompt (prompt là do user tạo, chấp nhận log ở debug).

## 9.8 Nguyên tắc an toàn khi bất định

Khi không chắc trạng thái trang (selector mơ hồ, DOM lạ) → **thà dừng và báo user** hơn là
đoán bừa rồi tải nhầm/đè nhầm. `needs_attention` luôn là lối thoát an toàn.

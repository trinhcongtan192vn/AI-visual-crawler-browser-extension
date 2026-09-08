# 01 — Kiến trúc tổng thể

## Các thành phần

```
┌──────────────────────────────────────────────────────────────┐
│  Side Panel (React UI)                                        │
│  - Import Excel, Preview prompt, Config, Run dashboard        │
│  - Parse Excel (SheetJS chạy ở đây)                           │
│  - Gửi lệnh & nhận cập nhật tiến độ qua runtime messaging     │
└───────────────┬──────────────────────────────────────────────┘
                │  chrome.runtime messages (port dài hạn)
┌───────────────▼──────────────────────────────────────────────┐
│  Service Worker (background) — QUEUE ENGINE                   │
│  - Giữ job queue + state machine                             │
│  - Điều phối tuần tự từng block                             │
│  - Mở/điều khiển tab provider, inject content script        │
│  - Gọi chrome.downloads, ghi manifest.csv                   │
│  - Persist state vào chrome.storage.local (resume)          │
└───────────────┬──────────────────────────────────────────────┘
                │  chrome.tabs.sendMessage / scripting.executeScript
┌───────────────▼──────────────────────────────────────────────┐
│  Content Script (trong tab chatgpt.com / gemini.google.com)  │
│  - PROVIDER ADAPTER: chạm DOM                                │
│  - Điền prompt, chọn model (Veo), bấm gửi                    │
│  - Chờ render xong, lấy URL ảnh/video                        │
│  - Detect rate-limit / lỗi trên trang                        │
└──────────────────────────────────────────────────────────────┘
```

## Vì sao chia như vậy

- **Service worker** là bộ não điều phối vì nó sống độc lập với UI (panel có thể đóng)
  và là nơi duy nhất được phép gọi `chrome.downloads`. Nó giữ state để resume.
- **Content script** là nơi duy nhất chạm DOM trang AI. Toàn bộ sự "dễ vỡ" khu trú ở đây.
- **Side panel** chỉ lo trình bày và nhập liệu. Parse Excel đặt ở panel vì SheetJS cần
  môi trường có DOM/File API thuận tiện, và kết quả parse là dữ liệu thuần gửi xuống worker.

> Lưu ý MV3: service worker có thể bị "ngủ". Vì mỗi bước tạo visual kéo dài (nhất là video),
> engine phải chịu được worker restart — xem `05` mục "Sống sót qua worker suspend".

## Luồng dữ liệu chính (happy path)

1. User nạp Excel ở panel → panel parse → ra mảng `Block[]` + config.
2. User bấm **Start** → panel gửi `START_BATCH { blocks, config }` xuống worker.
3. Worker tạo `Job[]` (mỗi block 1 job), lưu state, bật vòng lặp xử lý tuần tự.
4. Với mỗi job:
   a. Worker đảm bảo có tab provider đúng (mở nếu chưa), inject content script.
   b. Worker gửi `GENERATE { prompt, kind, aspectRatio }` xuống content script.
   c. Content script thao tác DOM, chờ xong, trả `GENERATE_RESULT { mediaUrl, mediaType }`.
   d. Worker tải file qua `chrome.downloads`, đặt tên theo quy ước, ghi vào manifest.
   e. Worker cập nhật job = `done`, phát `JOB_UPDATE` lên panel.
5. Hết queue → worker phát `BATCH_DONE`, ghi `manifest.csv`.

## Kênh giao tiếp (messaging)

Dùng **một long-lived port** giữa panel ↔ worker cho cập nhật tiến độ realtime,
và `chrome.tabs.sendMessage` cho worker ↔ content script (request/response từng lần).

### Panel ↔ Worker (port name: `avg-control`)

Panel → Worker:
- `START_BATCH { blocks: Block[], config: RunConfig }`
- `PAUSE_BATCH`
- `RESUME_BATCH`
- `RETRY_JOB { blockId }`
- `RETRY_ALL_FAILED`
- `CANCEL_BATCH`
- `GET_STATE` (khi panel mở lại, để đồng bộ)

Worker → Panel:
- `STATE_SNAPSHOT { batch: BatchState }` (trả lời GET_STATE)
- `JOB_UPDATE { job: Job }` (mỗi lần một job đổi trạng thái)
- `BATCH_UPDATE { status, counters }`
- `BATCH_DONE { summary }`
- `NEEDS_ATTENTION { reason, blockId? }` (VD: rate-limit, chưa đăng nhập)

### Worker ↔ Content Script (one-shot messages)

Worker → CS:
- `PING` → CS trả `PONG { provider, loggedIn: boolean }` (kiểm tra sẵn sàng)
- `GENERATE { requestId, prompt, kind: 'image'|'video', aspectRatio }`
- `ABORT { requestId }`

CS → Worker (trả lời GENERATE):
- `GENERATE_RESULT { requestId, ok: true, mediaUrl, mediaType: 'png'|'mp4' }`
- `GENERATE_ERROR { requestId, ok: false, errorType, message }`
  (errorType ∈ xem `09`: `RATE_LIMIT`, `NOT_LOGGED_IN`, `TIMEOUT`, `SELECTOR_MISS`,
   `PROVIDER_ERROR`, `UNSUPPORTED`)

> `requestId` để khớp request/response và bỏ qua kết quả trễ sau khi đã ABORT.

## Ranh giới trách nhiệm (tóm tắt)

| Thành phần | Được làm | KHÔNG làm |
|-----------|----------|-----------|
| Panel | UI, parse Excel, sinh prompt, hiển thị state | Không chạm DOM trang AI, không gọi downloads |
| Worker | Queue, state, downloads, persist, điều phối tab | Không chạm DOM trang AI, không parse Excel |
| Content script | Chạm DOM, generate, detect lỗi trang | Không quản queue, không tải file, không giữ state batch |

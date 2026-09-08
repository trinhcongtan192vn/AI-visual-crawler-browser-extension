# Technical Spec — AI Visual Generator Chrome Extension

Bộ tài liệu kỹ thuật để triển khai bằng Claude Code. Đọc theo thứ tự file.

## Mục lục

| File | Nội dung |
|------|----------|
| `00-README.md` | File này — tổng quan, quy ước, thứ tự triển khai |
| `01-architecture.md` | Kiến trúc tổng thể, các thành phần, luồng dữ liệu, message passing |
| `02-project-structure.md` | Cây thư mục, manifest.json, build/deps |
| `03-data-models.md` | Kiểu dữ liệu: Block, Job, Config, ProviderProfile, trạng thái |
| `04-excel-parser.md` | Parse Excel, validation, sinh prompt |
| `05-queue-engine.md` | Service worker: hàng đợi, state machine, resume, rate-limit |
| `06-provider-adapters.md` | Content script: adapter ChatGPT & Gemini, selector profile |
| `07-download-manager.md` | Tải file, đặt tên, manifest.csv |
| `08-ui-spec.md` | Side panel UI: 4 màn, components, state |
| `09-error-handling.md` | Phân loại lỗi, retry, detect rate-limit & render-done |
| `10-build-order.md` | Thứ tự implement theo milestone, checklist nghiệm thu |

## Bối cảnh sản phẩm (tóm tắt PRD)

Extension đọc file Excel kịch bản video YouTube (mỗi hàng = 1 "block"), sinh prompt,
tự động hóa UI của **chatgpt.com** hoặc **gemini.google.com** để tạo ảnh/video minh họa,
rồi tải về một thư mục con trong Downloads, đặt tên theo mã block.

Quyết định đã chốt:
- Hỗ trợ **cả ChatGPT và Gemini**. ChatGPT chỉ làm ảnh; block video khi dùng ChatGPT
  bị xử lý thành ảnh, tên có hậu tố `_img`.
- **Video chỉ trên Gemini (Veo)**: mỗi block video = 1 clip 8 giây.
- **Tự động hoàn toàn**, không có chế độ bán tự động.
- **Tỷ lệ khung hình** chọn mỗi lần nạp file: `16:9` hoặc `9:16`.
- **Rate limit**: tự phát hiện → dừng, giữ state, báo user, cho resume. Không đặt ngưỡng cứng.

## Quy ước kỹ thuật

- **Manifest V3**, Chrome (không cần hỗ trợ Firefox ở v1).
- **Ngôn ngữ:** TypeScript. UI: React + Vite. Không bắt buộc framework nặng.
- **Không** gọi API trả phí; chỉ tự động hóa UI web.
- **Không** dùng `localStorage`/`sessionStorage` trong bất kỳ UI nào; state persist qua `chrome.storage.local`.
- **Selector DOM tách riêng** thành file profile (xem `06`), coi là phần dễ vỡ nhất, phải dễ vá không cần build lại logic.
- Mọi thao tác bất đồng bộ có **timeout** và **phân loại lỗi** rõ ràng (xem `09`).
- Code có log gắn `[AVG]` prefix để lọc trong console.

## Nguyên tắc thiết kế cốt lõi

1. **Tách logic khỏi DOM.** Queue engine không biết gì về selector; nó chỉ ra lệnh
   "tạo visual cho block X" và nhận về "xong + file" hoặc "lỗi loại Y". Adapter provider
   là nơi duy nhất chạm DOM.
2. **Idempotent & resume-able.** Đóng panel giữa chừng không mất tiến độ; mở lại chạy tiếp.
3. **Fail per-block.** Một block lỗi không làm hỏng cả batch.
4. **Người dùng luôn thấy chuyện gì đang xảy ra.** Mỗi block có trạng thái quan sát được.

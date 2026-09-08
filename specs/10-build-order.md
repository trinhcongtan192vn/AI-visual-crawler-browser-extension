# 10 — Thứ tự triển khai & Checklist nghiệm thu

Hướng dẫn cho Claude Code: implement theo milestone, mỗi milestone chạy được & kiểm chứng
trước khi sang bước sau. Không cố làm hết một lần.

## M0 — Khung dự án
- [ ] Khởi tạo Vite + `@crxjs/vite-plugin` + TS + React (theo `02`).
- [ ] `manifest.json`, icons, `npm run build` load được vào Chrome không lỗi.
- [ ] `src/shared/types.ts`, `messages.ts`, `constants.ts`, `logger.ts` (theo `03`).
- [ ] Side panel mở được khi click action; hiển thị "Hello".
- [ ] Service worker chạy, log `[AVG]` khi cài.

**Nghiệm thu:** extension load, panel mở, worker sống, không lỗi console.

## M1 — Excel → Preview
- [ ] `parser.ts` map cột theo header, phân loại kind, validate (theo `04`).
- [ ] `prompt-builder.ts` + templates mặc định.
- [ ] Màn Import + màn Preview (bảng + chỉnh prompt inline).
- [ ] Màn Config (provider, tỷ lệ, thư mục, delay, template).

**Nghiệm thu:** nạp file mẫu → thấy đúng block, đúng phân loại, prompt hợp lý, ảnh không có
dòng âm thanh, video có. Đổi provider sang ChatGPT → block video hiện cờ downgrade.

## M2 — Content script luồng ẢNH cho CẢ HAI provider
- [ ] `dom-utils.ts` (waitFor, setPromptText, humanClick…).
- [ ] `selectors.ts` với DEFAULT_SELECTORS **đã kiểm chứng trên trang thật**.
- [ ] `adapter-base.ts` + `adapter-chatgpt.ts` + `adapter-gemini.ts` (chỉ nhánh ảnh).
- [ ] `content-entry.ts` route theo host, xử lý PING/GENERATE/ABORT.
- [ ] Test thủ công: gửi 1 prompt ảnh trên ChatGPT và trên Gemini, lấy được media URL.

**Nghiệm thu:** từ một trang test tay (hoặc worker gọi 1 lần), tạo được 1 ảnh và lấy URL/nút tải
trên cả hai provider. Chống nhầm turn hoạt động (không lấy ảnh cũ).

## M3 — Queue engine + download + manifest (luồng ảnh, chạy batch thật)
- [ ] `tab-manager.ts` (ensureProviderTab, ping, generate, abort).
- [ ] `queue-engine.ts` state machine + runLoop + persist (theo `05`).
- [ ] `download-manager.ts` cả đường A (URL) và B (page-triggered) + naming (theo `07`).
- [ ] `manifest-writer.ts` + xuất `manifest.csv`.
- [ ] Màn Run realtime (progress, bảng job, Pause/Resume/Retry/Cancel).
- [ ] Resume sau khi đóng/mở panel; sống sót worker suspend (keepalive alarm).

**Nghiệm thu:** chạy batch ≥20 block ảnh; file đặt tên đúng, gom đúng thư mục; đóng panel giữa
chừng mở lại vẫn tiếp; 1 block lỗi không làm hỏng batch; manifest.csv đúng.

## M4 — Video Veo (Gemini) + rate-limit detect + retry hoàn chỉnh
- [ ] Nhánh video trong `adapter-gemini.ts`: chọn model Veo, chờ video, lấy MP4 (theo `06`).
- [ ] Timeout video dài + phân biệt "đang render" vs "treo" (theo `09`).
- [ ] Detect `RATE_LIMIT` (ảnh + video) và `NOT_LOGGED_IN` → halt batch đúng trạng thái.
- [ ] Auto-retry cấp block + backoff; Retry/Retry-all ở UI.
- [ ] Downgrade video→ảnh khi provider=chatgpt (tên `_img`).

**Nghiệm thu:** block video trên Gemini ra file `.mp4` đúng tên; chạm giới hạn → batch dừng gọn
+ banner + resume được; block video trên ChatGPT ra `_img.png`.

## M5 — Hoàn thiện
- [ ] Override selector từ storage (vá nóng) + màn/vùng nhập override (tối thiểu: JSON paste).
- [ ] Đánh bóng UI theo `frontend-design` skill.
- [ ] Xử lý biên: file rỗng, toàn hàng skip, blockId trùng nhiều, prompt bị từ chối.
- [ ] README người dùng: cách cài, đăng nhập trước, giới hạn (watermark, 8s video, rủi ro ToS).

**Nghiệm thu:** vá được selector khi trang đổi mà không rebuild; luồng end-to-end mượt với file
kịch bản thật của user.

## Rủi ro cần nhắc lại khi bàn giao
- **Selector dễ vỡ:** đây là nợ bảo trì thường trực. Thiết kế override đã giảm đau nhưng không xóa.
- **ToS:** tự động hóa UI có rủi ro tài khoản; là đánh đổi đã chấp nhận.
- **Chất lượng ảnh:** ưu tiên nút tải chuyên dụng để tránh bản preview nén (xem `06.6`).
- **Video:** watermark + cố định 8s là giới hạn của Veo, không khắc phục ở extension.

## Gợi ý cho Claude Code
- Đọc lần lượt `01`→`09` trước khi code; `10` là bản đồ thực thi.
- Mỗi milestone: viết code + hướng dẫn test tay, dừng lại để người dùng kiểm chứng trên trang
  thật (vì selector chỉ xác minh được khi chạy thật).
- Giữ đúng ranh giới thành phần ở `01`; không để logic DOM rò vào worker hay ngược lại.

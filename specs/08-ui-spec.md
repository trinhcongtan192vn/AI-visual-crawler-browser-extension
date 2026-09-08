# 08 — UI Spec (Side Panel, React)

Files: `src/panel/`. Side panel, không phải popup (bảng block có thể dài).
Không dùng `localStorage`/`sessionStorage`; state tạm ở React, state bền qua worker + storage.

## 8.1 Điều hướng

4 màn theo bước, có thể quay lại: **Import → Preview → Config → Run**.
Thanh bước (stepper) trên cùng. Nút Back/Next. Không cho Next nếu bước hiện tại chưa hợp lệ.

Khi panel mở: gửi `GET_STATE`. Nếu có batch đang `running/paused/stopped_*` → nhảy thẳng
vào màn **Run** để tiếp tục theo dõi (không bắt user nạp lại file).

## 8.2 Màn Import (`ImportScreen.tsx`)

- Vùng kéo-thả + nút chọn file (`.xlsx`, `.csv`).
- Khi có file → chạy parser (04) → hiển thị:
  - Thẻ tổng quan: tổng block, số ảnh, số video, số skip.
  - Danh sách `fileWarnings` (hàng bỏ qua, id trùng, loại visual không rõ).
- Nút **Tiếp tục** bật khi parse thành công và có ≥1 block hợp lệ.
- Lỗi thiếu cột bắt buộc → hiển thị lỗi rõ + danh sách header đọc được.

## 8.3 Màn Preview (`PreviewScreen.tsx`)

Bảng tất cả block, mỗi dòng:
- `Mã block` | badge kind (Ảnh/Video, có icon "downgrade" nếu sẽ bị hạ cấp) | `Loại Visual` gốc.
- Ô prompt (textarea) hiển thị prompt đã sinh, **chỉnh inline được**; sửa xong lưu vào job.prompt.
- Cảnh báo mỗi block (nếu có) hiện dạng tooltip/nhãn nhỏ.
- Hàng skip hiển thị mờ + lý do; cho phép user bật lại (nếu họ điền lý do đủ mô tả — tối thiểu
  là bỏ trạng thái skip, tự chịu rủi ro prompt yếu).
- Nút **Áp dụng template lại** (nếu user đổi template ở Config rồi quay lại) — cảnh báo sẽ ghi
  đè các chỉnh tay.

> Kind hiển thị ở đây phụ thuộc provider đã chọn ở Config. Nếu user chưa vào Config, dùng
> provider mặc định (Gemini) để tính preview; đổi provider sẽ tính lại downgrade.

## 8.4 Màn Config (`ConfigScreen.tsx`)

- **Provider:** radio ChatGPT / Gemini. Ghi chú: ChatGPT chỉ tạo ảnh; block video sẽ thành ảnh.
- **Tỷ lệ khung hình:** chọn `16:9` (mặc định) / `9:16`.
- **Thư mục lưu:** text input, mặc định gợi ý theo tên file Excel (VD `YT_Visuals_<tên>`).
- **Độ trễ giữa block:** hai số min/max (mặc định 3000 / 8000 ms).
- **Template prompt:** hai textarea (image/video) prefill mặc định; có nút "Khôi phục mặc định".
- **Prefix/Suffix prompt:** optional, áp cho mọi block (style chung).
- Lưu `RunConfig` vào `LAST_CONFIG` để lần sau prefill.

## 8.5 Màn Run (`RunScreen.tsx`)

- **Thanh tiến độ tổng:** done/total + số failed + số skipped.
- **Trạng thái batch:** badge (running / paused / stopped_rate_limit / needs_attention / done).
- **Banner cảnh báo** khi `stopped_rate_limit` hoặc `needs_attention`: mô tả `attentionReason`
  + hướng dẫn ("Đăng nhập lại rồi bấm Tiếp tục" / "Đợi hết giới hạn rồi Tiếp tục").
- **Bảng job realtime:** mỗi dòng: blockId | kind | badge status (màu) | attempts | tên file khi
  xong | nút **Retry** khi failed. Cập nhật qua `JOB_UPDATE`.
- **Nút điều khiển:** Start (nếu chưa chạy) / Pause / Resume / Retry tất cả lỗi / Cancel /
  Mở thư mục (mở `chrome://downloads` hoặc hướng dẫn) / Xuất manifest.csv.
- Khi `BATCH_DONE`: hiện tóm tắt + danh sách block lỗi + gợi ý retry.

## 8.6 Kết nối worker (`port.ts`)

```ts
const port = chrome.runtime.connect({ name: 'avg-control' });
port.onMessage.addListener((msg: ProgressMsg) => updateStore(msg));
export function send(msg: ControlMsg) { port.dispatch(msg); }
```

- Panel giữ store cục bộ (jobs, batch status, counters) cập nhật từ ProgressMsg.
- Reconnect nếu port đứt (worker suspend) — mở lại port + `GET_STATE`.

## 8.7 Trạng thái & màu (gợi ý)

| Status | Màu | Ý nghĩa |
|--------|-----|---------|
| pending | xám | chờ |
| running | xanh dương (pulse) | đang chạy |
| done | xanh lá | xong |
| failed | đỏ | lỗi, retry được |
| skipped | vàng nhạt | bỏ qua |

## 8.8 Style

- Đọc `frontend-design` skill khi implement để có hệ design tokens nhất quán.
- Ưu tiên gọn, rõ, mật độ thông tin cao (đây là công cụ vận hành, không phải landing page).
- Không animation thừa; chỉ pulse nhẹ ở dòng đang chạy.

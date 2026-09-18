# AI Visual Generator — Chrome Extension

Đọc file Excel kịch bản video YouTube, tự sinh prompt, tự động hóa ChatGPT/Gemini để tạo
ảnh/video minh họa, tải về gom vào một thư mục con trong Downloads. Xem chi tiết nghiệp vụ ở
`specs/PRD_AI_Visual_Generator_Extension.md` và các file `specs/0X-*.md`.

## Cài đặt & chạy dev

```bash
npm install
npm run dev      # build watch mode (dùng khi phát triển)
# hoặc
npm run build    # build tĩnh 1 lần ra dist/
```

Nạp vào Chrome:
1. Mở `chrome://extensions`.
2. Bật **Developer mode** (góc trên phải).
3. **Load unpacked** → chọn thư mục `dist/`.
4. Ghim icon extension → bấm để mở side panel.

Kiểm tra nhanh không lỗi:

```bash
npm run typecheck
npm run build
```

## Trước khi dùng thật

1. **Đăng nhập sẵn** ChatGPT (chatgpt.com) và/hoặc Gemini (gemini.google.com) trên Chrome —
   extension không xử lý đăng nhập hộ bạn.
2. Chuẩn bị file Excel đúng 6 cột theo `specs/04-excel-parser.md` (header linh hoạt, không cần
   đúng thứ tự, chỉ cần chứa đúng cụm từ khóa).
3. Mở side panel → Import file → xem Preview prompt → vào Config chọn provider/tỷ lệ/thư mục →
   bấm **Bắt đầu**.

## ⚠️ Giới hạn & rủi ro đã biết (đọc trước khi vận hành thật)

- **Selector DOM: đã xác minh luồng ẢNH trên cả ChatGPT và Gemini** (ô nhập prompt, nút gửi,
  ảnh kết quả, lấy ảnh full-size) qua nhiều vòng test tay trực tiếp trên trang thật — xem
  `src/content/selectors.ts` (các dòng có ghi "Xác nhận trực tiếp..."). **Vẫn CHƯA xác minh**:
  luồng video (Veo) trên Gemini, và các marker rate-limit/lỗi/đăng xuất — nếu gặp lỗi lạ ở các
  phần này, cần lặp lại quy trình soi DOM (DevTools → sửa `src/content/selectors.ts` hoặc nạp
  override qua `chrome.storage.local` key `avg.selectors`, không cần build lại — xem `06.2`).
- **Nút "Download" trên trang không phản hồi với click giả lập của extension** (nghi do trang
  kiểm tra `event.isTrusted`, chặn hành vi tự động). Với Gemini, extension đã có cách lách: lấy
  thẳng ảnh gốc qua URL (`lh3.googleusercontent.com/...=s0`) thay vì bấm nút. Nếu về sau trang
  đổi domain/định dạng URL ảnh, cách này có thể cần cập nhật lại.
- **Video (Veo) trên Gemini**: mỗi block chỉ ra **1 clip 8 giây**, có watermark hiển thị +
  SynthID vô hình, và có hạn mức/tháng theo gói tài khoản — extension tự phát hiện khi chạm hạn
  mức và dừng batch, nhưng không thể tăng hạn mức hộ bạn.
- **ChatGPT chỉ tạo ảnh.** Nếu chọn ChatGPT làm provider, mọi block được đánh dấu "video" trong
  Excel sẽ tự động bị hạ thành ảnh (tên file thêm hậu tố `_img.png`).
- **Rủi ro vi phạm Điều khoản dịch vụ**: đây là tự động hóa giao diện web (không dùng API trả
  phí chính thức), có rủi ro tài khoản cố hữu — là đánh đổi đã được chấp nhận trong PRD để đạt
  tự động hoàn toàn.
- **Chất lượng ảnh**: extension ưu tiên nút "Download" chuyên dụng của trang để lấy file gốc;
  nếu trang không có nút này, sẽ dùng `<img src>` hiển thị — có thể là bản preview nén thấp hơn
  bản gốc.

## Cấu trúc dự án

Xem `specs/02-project-structure.md`. Tóm tắt:
- `src/background/` — service worker: hàng đợi, tải file, ghi manifest, persist state.
- `src/content/` — content script chạy trên chatgpt.com/gemini.google.com: chạm DOM.
- `src/panel/` — side panel React: Import → Preview → Config → Run.
- `src/shared/` — kiểu dữ liệu & message contract dùng chung.
- `src/config/` — template prompt mặc định, bộ từ khóa phân loại ảnh/video.

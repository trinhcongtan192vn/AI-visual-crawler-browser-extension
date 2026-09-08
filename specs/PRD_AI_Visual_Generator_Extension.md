# PRD — Chrome Extension: AI Visual Generator cho Video YouTube

**Phiên bản:** v1.0 (draft để review)
**Người soạn:** Tan
**Ngày:** 2026-09-04
**Trạng thái:** Draft

---

## 1. Bối cảnh & Vấn đề

Quy trình sản xuất video YouTube hiện tại cần minh họa cho từng cảnh (block). Kịch bản đầu ra là file Excel với các block riêng biệt, mỗi block cần 1 ảnh hoặc 1 video minh họa. Việc tạo thủ công từng ảnh/video trên ChatGPT/Gemini, rồi tải về và đặt tên đúng mã block, tốn nhiều thời gian và dễ sai sót khi số lượng block lớn (một video có thể 30–80 block).

**Mục tiêu:** Một Chrome extension đọc file Excel kịch bản, tự động sinh prompt, đưa vào ChatGPT/Gemini qua giao diện web, thu ảnh kết quả, tải về và đặt tên theo mã block — tất cả gom vào một thư mục.

---

## 2. Mục tiêu & Phi mục tiêu

### 2.1 Mục tiêu (v1)
- Nhập file Excel, parse 6 cột theo schema định sẵn.
- Tự dựng prompt cho từng block dựa trên `Loại Visual`, `Hình ảnh & Hiệu ứng`, `Âm thanh & Nhạc nền`.
- Hỗ trợ **cả ChatGPT và Gemini**. ChatGPT chỉ xử lý ảnh; block video sẽ tự chuyển thành xử lý ảnh khi provider là ChatGPT (xem mục 6).
- Tự động hóa **toàn bộ** luồng: nhập prompt → gửi → chờ kết quả → tải ảnh/video. Không có bước thủ công.
- Cho phép chọn **tỷ lệ khung hình** (16:9 hoặc 9:16) trên UI mỗi lần nạp file.
- Đặt tên file theo mã block, lưu chung một thư mục con trong Downloads.
- Bảng theo dõi tiến độ từng block (chờ / đang chạy / xong / lỗi) và cho retry.
- Tự phát hiện rate limit từ ChatGPT/Gemini, dừng tiến trình và báo người dùng.

### 2.2 Phi mục tiêu (v1)
- Không gọi API trả phí của OpenAI/Google (v1 chỉ tự động hóa UI web — theo lựa chọn của bạn).
- Không tự cắt/ghép/hậu kỳ video sau khi tải về (extension chỉ tạo & tải clip gốc từ Veo).
- Không chèn nhạc nền/SFX ngoài vào file (audio dùng để làm giàu prompt; Veo tự sinh audio trong clip).
- Không đăng tải hay chỉnh sửa file Excel gốc.

---

## 3. Người dùng & Use case

**Người dùng chính:** Nhà sản xuất nội dung / biên tập vận hành kênh YouTube, quen thao tác ChatGPT/Gemini nhưng muốn giảm việc lặp lại.

**Luồng chính:**
1. Người dùng đăng nhập sẵn ChatGPT hoặc Gemini trên trình duyệt.
2. Mở extension, tải file Excel kịch bản.
3. Chọn AI provider (ChatGPT / Gemini) và thư mục lưu.
4. Xem trước danh sách block + prompt được sinh, chỉnh nếu cần.
5. Bấm "Bắt đầu" → extension chạy từng block tuần tự.
6. Theo dõi tiến độ, xử lý block lỗi (retry hoặc làm tay).
7. Kết thúc: tất cả ảnh nằm trong một thư mục, đặt tên theo mã block.

---

## 4. Đầu vào — Schema Excel

| Cột | Tên cột | Bắt buộc | Dùng để |
|-----|---------|----------|---------|
| 1 | Mã block | Có | Đặt tên file đầu ra (VD `B01`) |
| 2 | Thời lượng | Không | Metadata; gợi ý độ dài với loại video |
| 3 | Loại Visual | Có | Phân loại ảnh / video → quyết định luồng xử lý |
| 4 | Hình ảnh & Hiệu ứng (Visual/FX) | Có | Mô tả chính để dựng prompt visual |
| 5 | Âm thanh & Nhạc nền (Audio/SFX) | Không | Chỉ dùng khi là video; bỏ qua khi là ảnh |
| 6 | Kịch bản Giọng đọc (VO Content) | Không | Ngữ cảnh phụ để prompt bám nội dung cảnh |

**Quy tắc phân loại `Loại Visual`:**
- Chứa từ khóa ảnh (VD: `image`, `ảnh`, `hình`, `still`) → luồng **Ảnh**.
- Chứa từ khóa video (VD: `video`, `clip`, `motion`, `animation`) → luồng **Video**.
- Không rõ → mặc định **Ảnh** + đánh cờ cảnh báo để người dùng xác nhận.
- Bộ từ khóa để trong file config, người dùng chỉnh được.
- Luồng **Video** chỉ khả dụng khi provider là **Gemini** (dùng Veo). Nếu provider đang chọn là **ChatGPT**, mọi block dù ghi là video đều được **xử lý thành ảnh** (dùng template ảnh), và đánh cờ trong bảng để người dùng biết.

**Validation khi import:** thiếu cột bắt buộc → báo lỗi; mã block trùng → cảnh báo; hàng trống ở cột mô tả → bỏ qua hoặc đánh dấu skip.

---

## 5. Dựng Prompt

Extension ghép prompt từ các cột theo template có thể chỉnh sửa.

**Template ảnh (mặc định):**
```
{Hình ảnh & Hiệu ứng}.
Bối cảnh cảnh quay: {VO Content rút gọn}.
Yêu cầu: ảnh minh họa chất lượng cao, tỷ lệ {tỷ lệ chọn ở UI}, không chèn chữ.
```

**Template video (Veo, mặc định):**
```
{Hình ảnh & Hiệu ứng}.
Chuyển động / hiệu ứng máy quay: {trích phần FX}.
Âm thanh trong cảnh: {Âm thanh & Nhạc nền}.
Phong cách: điện ảnh, tỷ lệ {tỷ lệ chọn ở UI}.
```

- Với luồng **Ảnh**: bỏ qua cột Âm thanh (theo yêu cầu).
- Với luồng **Video**: đưa mô tả âm thanh vào prompt vì Veo tự sinh audio trong clip. Không đưa "Thời lượng" vào prompt vì Veo cố định 8 giây.
- Prompt sinh ra hiển thị ở màn preview để chỉnh trước khi chạy.
- Cho phép đặt "prompt prefix/suffix" chung (VD phong cách nhất quán cho cả video).

---

## 6. Xử lý loại Video (Gemini / Veo)

Gemini tạo video trực tiếp trong UI qua Veo: chọn model video từ dropdown, nhập prompt, chờ render, video xong có nút tải MP4. Extension tự động hóa đúng luồng này.

**Đặc điểm & ràng buộc của Veo (ảnh hưởng thiết kế):**
- Mỗi lần tạo ra **1 clip 8 giây**, mặc định **720p, 16:9, MP4**. Đã chốt: mỗi block video = **1 clip 8s duy nhất**; cột "Thời lượng" chỉ là metadata, không ép Veo tạo dài hơn.
- Phải **chọn model video từ dropdown** trước khi gửi prompt — content script cần thêm bước này, khác luồng ảnh (chỉ gõ prompt).
- Thời gian render **lâu hơn ảnh nhiều** → timeout và điều kiện "chờ xong" cho video phải riêng, dài hơn.
- Video có **giới hạn số lượng/tháng** theo gói tài khoản → extension cần bắt lỗi khi chạm hạn mức và dừng gọn, báo rõ.
- Mọi clip có **watermark hiển thị + SynthID vô hình** — chấp nhận với mục đích minh họa; ghi rõ để người dùng biết.

**Luồng xử lý block video:**
1. Đảm bảo provider = Gemini và đã chọn đúng model Veo.
2. Điền prompt video (mục 5) → gửi.
3. Chờ theo điều kiện video render xong (poll trạng thái/phần tử player + nút tải), timeout dài.
4. Lấy MP4, đặt tên `{Mã block}.mp4`, lưu chung thư mục.
5. Lỗi/timeout/chạm hạn mức → đánh dấu để retry hoặc làm tay.

---

## 7. Tự động hóa UI (Content Script)

**Cách hoạt động:** content script chèn vào chatgpt.com / gemini.google.com, thực hiện: (với video trên Gemini: chọn model Veo trước) → điền prompt vào ô nhập → gửi → chờ ảnh/video render xong → lấy kết quả → tải về.

**Rủi ro & cách giảm thiểu (nêu rõ để review):**
- **DOM thay đổi:** selector nằm trong file cấu hình riêng, cập nhật không cần build lại logic chính.
- **Chống bot:** thêm độ trễ ngẫu nhiên giữa các block để hành vi tự nhiên hơn.
- **Rate limit / chạm hạn mức:** extension **tự phát hiện** dấu hiệu bị giới hạn (thông báo lỗi trên UI của ChatGPT/Gemini, hết lượt tạo video, hoặc chờ quá timeout lặp lại) → **tự dừng tiến trình**, giữ nguyên state, và báo người dùng biết đã dừng ở block nào. Người dùng chạy tiếp (resume) khi hết giới hạn.
- **Phát hiện "render xong":** chờ theo điều kiện xuất hiện phần tử ảnh/video + nút tải, có timeout (video timeout dài hơn ảnh); timeout → đánh lỗi để retry.
- **Vi phạm ToS:** tự động hóa UI có rủi ro tài khoản cố hữu — đây là đánh đổi đã được chấp nhận để đạt tự động hóa toàn bộ (không dùng chế độ bán tự động).

---

## 8. Đầu ra & Lưu file

- Cơ chế: `chrome.downloads` API, tự đặt tên và tải, không cần click tay.
- Quy ước tên: `{Mã block}.png` cho ảnh; `{Mã block}.mp4` cho video (Gemini). Block gốc là video nhưng bị xử lý thành ảnh vì dùng ChatGPT → `{Mã block}_img.png` để đánh dấu.
- Thư mục: một thư mục con trong Downloads, VD `Downloads/YT_Visuals_{tên project}/`.
- Trùng tên: hậu tố `_v2`, `_v3` khi regenerate.
- Xuất kèm `manifest.csv`: mã block, loại, prompt đã dùng, tên file, trạng thái — để đối soát.

---

## 9. Giao diện Extension

- **Màn Import:** kéo-thả Excel, hiện tóm tắt (tổng block, số ảnh, số video, cảnh báo).
- **Màn Preview:** bảng từng block + prompt sinh ra (chỉnh inline được).
- **Màn Cấu hình:** chọn provider (ChatGPT / Gemini), tỷ lệ khung hình (16:9 / 9:16), thư mục, độ trễ, template prompt.
- **Màn Run:** thanh tiến độ tổng, trạng thái từng block, nút Pause / Retry lỗi / Retry tất cả.

---

## 10. Kiến trúc kỹ thuật (đề xuất)

- **Manifest V3.**
- **Popup / Side panel (React hoặc vanilla):** UI + quản lý hàng đợi.
- **Service worker (background):** điều phối hàng đợi, gọi `chrome.downloads`, giữ state.
- **Content script:** thao tác DOM trên ChatGPT/Gemini.
- **Excel parsing:** thư viện SheetJS (xlsx) trong popup.
- **Storage:** `chrome.storage.local` lưu cấu hình, template, tiến độ (để resume).
- **Permissions:** `downloads`, `storage`, `scripting`, `activeTab`, host permissions cho `chatgpt.com` và `gemini.google.com`.

---

## 11. Yêu cầu phi chức năng

- Chạy tuần tự, resume được nếu đóng popup giữa chừng.
- Xử lý lỗi từng block độc lập — 1 block lỗi không dừng cả batch.
- Có log để debug (console + manifest.csv).
- Không lưu trữ nội dung nhạy cảm; không gửi dữ liệu ra server ngoài.

---

## 12. Tiêu chí thành công (v1)

- Import đúng file Excel mẫu, sinh prompt chính xác cho ≥ 95% block.
- Chạy tự động một batch ≥ 20 block ảnh, tỷ lệ tải thành công ≥ 80% (không tính lỗi phía AI).
- File đặt tên đúng mã block, gom đúng một thư mục.
- Người dùng retry được block lỗi mà không chạy lại toàn bộ.

---

## 13. Cột mốc

| Giai đoạn | Nội dung |
|-----------|----------|
| M1 | Import Excel + parse + preview prompt |
| M2 | Content script cho **cả ChatGPT và Gemini** (luồng ảnh) + tải 1 ảnh |
| M3 | Hàng đợi batch + đặt tên + manifest.csv |
| M4 | Xử lý video Veo trên Gemini + rate-limit detect + retry/resume |
| M5 | Cấu hình selector/template + hoàn thiện UI |

---

## 14. Quyết định đã chốt

- **Provider:** hỗ trợ cả ChatGPT và Gemini, **hoàn thiện cả hai ngay ở M2**. ChatGPT chỉ làm ảnh; block video khi dùng ChatGPT sẽ tự xử lý thành ảnh.
- **Mức tự động:** tự động toàn bộ, không có chế độ bán tự động.
- **Tỷ lệ khung hình:** mặc định 16:9, người dùng chọn 16:9 hoặc 9:16 trên UI mỗi lần nạp file.
- **Video:** mỗi block video = 1 clip Veo 8 giây; cột "Thời lượng" chỉ là metadata.
- **Đặt tên khi video bị hạ thành ảnh (ChatGPT):** thêm hậu tố đánh dấu → `{Mã block}_img.png`, để phân biệt với ảnh gốc và với video Veo `{Mã block}.mp4`.
- **Rate limit:** không đặt ngưỡng cứng; tự phát hiện khi bị giới hạn → dừng và báo người dùng, cho resume.
- **Cột mốc M2:** hoàn thiện luồng ảnh cho cả ChatGPT và Gemini cùng lúc.
- **Đặt tên block video-thành-ảnh (ChatGPT):** dùng hậu tố `{Mã block}_img.png` để phân biệt với ảnh thường.

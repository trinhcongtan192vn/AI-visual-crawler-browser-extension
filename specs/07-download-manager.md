# 07 — Download Manager & Manifest Writer

Files: `src/background/download-manager.ts`, `src/background/manifest-writer.ts`.
Chỉ chạy ở service worker (nơi duy nhất gọi `chrome.downloads`).

## 7.1 Quy ước đặt tên

Cho block với `blockId` (đã làm sạch ký tự không hợp lệ cho tên file):

| Trường hợp | Tên file |
|-----------|----------|
| Ảnh (kind=image, không downgrade) | `{blockId}.png` |
| Video Gemini (kind=video) | `{blockId}.mp4` |
| Block gốc video nhưng downgrade→ảnh (provider=chatgpt) | `{blockId}_img.png` |
| Regenerate/retry tạo bản mới | thêm hậu tố `_v2`, `_v3`… trước phần mở rộng |

Làm sạch `blockId` cho tên file: thay ký tự `\ / : * ? " < > |` và khoảng trắng đầu/cuối,
giữ chữ, số, `-`, `_`. Nếu rỗng sau khi làm sạch → dùng `block_<rowIndex>`.

Thư mục: tất cả vào `Downloads/{config.outputFolder}/`. `chrome.downloads.download` với
`filename: "{outputFolder}/{fileName}"` (Chrome tạo thư mục con tự động).
`conflictAction: 'uniquify'` để không ghi đè ngoài ý muốn (bổ trợ cho quy tắc `_vN`).

## 7.2 Hai đường tải file

### Đường A — có URL (href hoặc data/blob URL từ content script)

```ts
export async function saveByUrl(url: string, fileName: string, folder: string): Promise<number> {
  return chrome.downloads.download({
    url,
    filename: `${folder}/${fileName}`,
    conflictAction: 'uniquify',
    saveAs: false
  });
}
```

- Trả `downloadId`. Chờ hoàn tất qua `chrome.downloads.onChanged` (state=complete) hoặc lỗi.
- Nếu `url` là `blob:` thuộc context content script → **không** dùng trực tiếp ở worker được;
  content script phải chuyển thành data URL trước khi gửi (xem 06.6 đường 3).

### Đường B — trang tự tải, worker đổi tên ("Bắt file do trang tự tải")

Dùng khi nút tải của provider tự kích hoạt download trình duyệt (không có href lấy được).

- Bật listener `chrome.downloads.onDeterminingFilename` **chỉ trong khoảng** đang chờ 1 job:
  ```ts
  chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
    if (expectingCapture) {
      suggest({ filename: `${folder}/${pendingFileName}`, conflictAction: 'uniquify' });
      expectingCapture = false;
    }
  });
  ```
- Trình tự: worker đặt `expectingCapture=true` + `pendingFileName` → ra lệnh content script bấm
  nút tải → download xuất hiện → listener đổi tên. Có timeout: nếu không thấy download trong
  X giây → coi như `DOWNLOAD_FAILED`.
- Rủi ro: nếu user vô tình tải thứ khác cùng lúc sẽ bị đổi tên nhầm. Vì chạy tuần tự và cửa sổ
  capture hẹp nên chấp nhận được; ghi log rõ.

> Chọn đường nào là do adapter quyết định (nó biết có href hay không) và báo cho worker qua
> trường trong `GENERATE_RESULT` (thêm `captureMode: 'url' | 'page-triggered'`).

## 7.3 Xác nhận hoàn tất & lỗi tải

```ts
export function waitDownloadComplete(id: number, timeoutMs: number): Promise<void>;
```

- Theo dõi `chrome.downloads.onChanged`: `state.current==='complete'` → resolve;
  `state.current==='interrupted'` → reject `DOWNLOAD_FAILED`.
- Timeout → reject `DOWNLOAD_FAILED`.
- `DOWNLOAD_FAILED` được engine (05) retry tối đa 2 lần với backoff.

## 7.4 Manifest writer (`manifest-writer.ts`)

Ghi một dòng cho mỗi job hoàn tất (hoặc thất bại cuối cùng) để đối soát.

Cột CSV:
```
blockId, originalKind, executedKind, downgraded, provider, aspectRatio,
status, attempts, outputFileName, errorType, promptUsed, timestamp
```

- Gom trong bộ nhớ (`records: ManifestRecord[]`), persist kèm BatchState để không mất khi
  worker suspend.
- Khi `BATCH_DONE` (hoặc user bấm "Xuất manifest"): tạo CSV, tải về
  `{outputFolder}/manifest.csv`.
- CSV escape đúng: bọc trường có dấu phẩy/xuống dòng/nháy kép trong `"..."`, nhân đôi nháy kép.
- `promptUsed` có thể dài/nhiều dòng → phải escape; cân nhắc rút gọn nếu quá dài (giữ full ở
  BatchState, cắt trong CSV nếu cần, VD 500 ký tự + "…").
- BOM UTF-8 đầu file để Excel mở tiếng Việt không lỗi font.

## 7.5 Nghiệm thu

- Tải 1 ảnh → đúng tên `{blockId}.png` trong đúng thư mục.
- Video Gemini → `{blockId}.mp4`.
- Block video chạy trên ChatGPT → `{blockId}_img.png`.
- Chạy lại 1 block đã có file → ra `_v2` (không đè bản cũ).
- `manifest.csv` mở bằng Excel hiển thị tiếng Việt đúng, mỗi block một dòng.

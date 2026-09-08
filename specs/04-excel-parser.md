# 04 — Excel Parser & Prompt Builder

Nằm ở panel (`src/panel/excel/`). Đầu ra là `Block[]` sạch + prompt sẵn sàng.

## 4.1 Parse Excel (`parser.ts`)

### Đầu vào
File `.xlsx`/`.csv` do user kéo-thả. Dùng SheetJS đọc sheet đầu tiên.

### Ánh xạ cột

Cột nhận diện theo **header text** (không theo vị trí cứng, vì user có thể chèn cột).
Chuẩn hóa header: bỏ dấu cách thừa, so khớp không phân biệt hoa/thường.

| Trường | Header khớp (chứa) |
|--------|--------------------|
| `blockId` | `mã block`, `ma block`, `block` |
| `duration` | `thời lượng`, `thoi luong`, `duration` |
| `rawVisualType` | `loại visual`, `loai visual`, `visual type` |
| `visualFx` | `hình ảnh`, `visual/fx`, `visual` |
| `audioSfx` | `âm thanh`, `audio/sfx`, `audio` |
| `voContent` | `giọng đọc`, `vo content`, `vo` |

Nếu không tìm được cột bắt buộc (`blockId`, `rawVisualType`, `visualFx`) → **abort parse**,
trả lỗi kèm danh sách header đọc được để user đối chiếu.

### Phân giải `resolvedKind`

```ts
const VIDEO_KEYWORDS = ['video', 'clip', 'motion', 'animation', 'động', 'chuyển động'];
const IMAGE_KEYWORDS = ['image', 'ảnh', 'hình', 'still', 'picture'];
```

Quy tắc (chạy trên `rawVisualType` đã lowercase, bỏ dấu để so khớp rộng):
1. Khớp keyword video → `video`.
2. Khớp keyword ảnh → `image`.
3. Không khớp → `image` + push warning `"Loại Visual '<giá trị>' không rõ, mặc định Ảnh"`.

> Bộ keyword để trong `config/` và cho override qua UI/storage (không hardcode rải rác).

### Validation từng hàng

- `blockId` rỗng → skip hàng, warning ở cấp file `"Hàng <n> thiếu Mã block, đã bỏ qua"`.
- `visualFx` rỗng → đánh dấu block `status skip` (không đủ mô tả để tạo).
- `blockId` trùng → giữ hàng đầu, các hàng sau đổi tên `"<id>_dup<n>"` + warning; KHÔNG âm thầm ghi đè.
- Chuẩn hóa whitespace mọi ô; cắt ký tự không hợp lệ cho tên file khỏi `blockId`
  khi dùng đặt tên (xem `07`), nhưng giữ nguyên `blockId` gốc để hiển thị.

### Kết quả parse

```ts
export interface ParseResult {
  blocks: Block[];
  fileWarnings: string[];    // cảnh báo cấp file (hàng bỏ qua, trùng id...)
  stats: { total: number; images: number; videos: number; skipped: number };
}
```

Panel hiển thị `stats` + `fileWarnings` ở màn Import trước khi cho sang Preview.

## 4.2 Prompt Builder (`prompt-builder.ts`)

### Template mặc định (`config/default-templates.ts`)

Placeholder bọc `{{ }}`. Placeholder hỗ trợ:
`{{visualFx}}`, `{{voContent}}`, `{{audioSfx}}`, `{{aspectRatio}}`, `{{duration}}`.

```ts
export const DEFAULT_IMAGE_TEMPLATE =
`{{visualFx}}.
Bối cảnh cảnh quay: {{voContent}}.
Yêu cầu: ảnh minh họa chất lượng cao, tỷ lệ {{aspectRatio}}, không chèn chữ.`;

export const DEFAULT_VIDEO_TEMPLATE =
`{{visualFx}}.
Chuyển động / hiệu ứng máy quay: {{visualFx}}.
Âm thanh trong cảnh: {{audioSfx}}.
Phong cách: điện ảnh, tỷ lệ {{aspectRatio}}.`;
```

### Quy tắc ghép

1. Chọn template theo `job.kind` (đã tính downgrade — video→image dùng template image).
2. Thay placeholder. Placeholder không có dữ liệu → thay bằng chuỗi rỗng và **dọn**
   dòng trống / label thừa (VD nếu `voContent` rỗng thì bỏ luôn dòng "Bối cảnh...").
3. `voContent` dài → rút gọn còn ~200 ký tự (cắt theo câu, không cắt giữa từ).
4. Với **ảnh**: KHÔNG chèn `audioSfx` dù template có (bỏ theo yêu cầu sản phẩm).
   Thực thi bằng cách: nếu `kind==='image'`, xóa mọi dòng chứa `{{audioSfx}}` trước khi thay.
5. Ghép `promptPrefix` + newline + body + newline + `promptSuffix` (nếu có).
6. Trim, chuẩn hóa xuống dòng (tối đa 1 dòng trống liên tiếp).

### Hàm chính

```ts
export function buildPrompt(block: Block, job: Job, config: RunConfig): string;
```

Prompt sinh ra được gắn vào `job.prompt` và hiển thị ở màn Preview cho user chỉnh inline.
Chỉnh tay ở Preview sẽ ghi đè `job.prompt`; sau đó prompt-builder không đụng vào nữa.

## 4.3 Test nhanh (nghiệm thu module)

- File mẫu 6 cột đúng header → parse ra đúng số block, đúng phân loại image/video.
- Header xáo trộn thứ tự → vẫn map đúng.
- Hàng trống `blockId` → bị bỏ qua + có warning.
- `Loại Visual` = "Video 8s" → `video`; = "Ảnh tĩnh" → `image`; = "abc" → `image`+warning.
- Block ảnh: prompt không chứa dòng âm thanh. Block video: prompt có dòng âm thanh.

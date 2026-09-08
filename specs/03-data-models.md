# 03 — Data Models (src/shared/types.ts)

Toàn bộ kiểu dữ liệu dùng chung. Đây là "hợp đồng" giữa panel, worker, content script.

## Enums / union types

```ts
export type Provider = 'chatgpt' | 'gemini';

export type AspectRatio = '16:9' | '9:16';

// Loại visual sau khi đã phân giải (resolved), không phải chuỗi thô từ Excel
export type ResolvedKind = 'image' | 'video';

export type JobStatus =
  | 'pending'      // chờ tới lượt
  | 'running'      // đang xử lý
  | 'done'         // xong, đã tải file
  | 'failed'       // lỗi, có thể retry
  | 'skipped';     // bị bỏ qua (hàng trống / user skip)

export type BatchStatus =
  | 'idle'
  | 'running'
  | 'paused'
  | 'stopped_rate_limit'   // dừng do rate limit, chờ user
  | 'needs_attention'      // VD chưa đăng nhập
  | 'done'
  | 'cancelled';

export type ErrorType =
  | 'RATE_LIMIT'
  | 'NOT_LOGGED_IN'
  | 'TIMEOUT'
  | 'SELECTOR_MISS'
  | 'PROVIDER_ERROR'
  | 'DOWNLOAD_FAILED'
  | 'UNSUPPORTED'
  | 'UNKNOWN';
```

## Block — một hàng Excel đã parse

```ts
export interface Block {
  blockId: string;           // Cột "Mã block" — bắt buộc, duy nhất
  duration?: string;         // "Thời lượng" — metadata, không ép vào Veo
  rawVisualType: string;     // "Loại Visual" — chuỗi thô
  resolvedKind: ResolvedKind;// suy ra từ rawVisualType (04)
  visualFx: string;          // "Hình ảnh & Hiệu ứng (Visual/FX)" — mô tả chính
  audioSfx?: string;         // "Âm thanh & Nhạc nền (Audio/SFX)"
  voContent?: string;        // "Kịch bản Giọng đọc (VO Content)"
  rowIndex: number;          // vị trí hàng trong file (để báo lỗi)
  warnings: string[];        // VD "Loại Visual không rõ, mặc định ảnh"
}
```

## RunConfig — cấu hình một lần chạy

```ts
export interface RunConfig {
  provider: Provider;
  aspectRatio: AspectRatio;      // 16:9 mặc định
  outputFolder: string;          // tên thư mục con trong Downloads
  interBlockDelayMs: {           // độ trễ ngẫu nhiên giữa các block
    min: number;                 // mặc định 3000
    max: number;                 // mặc định 8000
  };
  promptTemplates: {
    image: string;               // template có placeholder (04)
    video: string;
  };
  promptPrefix?: string;         // style chung, chèn đầu prompt
  promptSuffix?: string;
}
```

## Job — đơn vị xử lý trong queue (1 block = 1 job)

```ts
export interface Job {
  blockId: string;
  kind: ResolvedKind;            // kind thực thi (có thể bị hạ cấp, xem dưới)
  originalKind: ResolvedKind;    // kind gốc từ Excel
  downgraded: boolean;           // true nếu video→image do provider=chatgpt
  prompt: string;                // prompt cuối cùng (đã ghép template + prefix/suffix)
  status: JobStatus;
  attempts: number;
  lastError?: { type: ErrorType; message: string };
  outputFileName?: string;       // sau khi tải xong
  outputMediaType?: 'png' | 'mp4';
  startedAt?: number;
  finishedAt?: number;
}
```

### Quy tắc "downgrade" (video → image)

Khi `config.provider === 'chatgpt'` và `block.resolvedKind === 'video'`:
- `job.kind = 'image'`, `job.originalKind = 'video'`, `job.downgraded = true`.
- Prompt dùng template **image**.
- Tên file dùng hậu tố `_img` (xem `07`).

## BatchState — trạng thái toàn cục của một batch (persist)

```ts
export interface BatchState {
  batchId: string;               // uuid, tạo khi START_BATCH
  status: BatchStatus;
  config: RunConfig;
  jobs: Job[];
  currentIndex: number;          // job đang/next xử lý
  counters: {
    total: number;
    done: number;
    failed: number;
    skipped: number;
  };
  createdAt: number;
  updatedAt: number;
  attentionReason?: string;      // khi status = needs_attention / stopped_rate_limit
}
```

## Message payloads (src/shared/messages.ts)

Định nghĩa rời để type-safe cho cả hai đầu. Ví dụ:

```ts
// Panel -> Worker
export type ControlMsg =
  | { type: 'START_BATCH'; blocks: Block[]; config: RunConfig }
  | { type: 'PAUSE_BATCH' }
  | { type: 'RESUME_BATCH' }
  | { type: 'RETRY_JOB'; blockId: string }
  | { type: 'RETRY_ALL_FAILED' }
  | { type: 'CANCEL_BATCH' }
  | { type: 'GET_STATE' };

// Worker -> Panel
export type ProgressMsg =
  | { type: 'STATE_SNAPSHOT'; batch: BatchState | null }
  | { type: 'JOB_UPDATE'; job: Job }
  | { type: 'BATCH_UPDATE'; status: BatchStatus; counters: BatchState['counters'] }
  | { type: 'BATCH_DONE'; summary: BatchSummary }
  | { type: 'NEEDS_ATTENTION'; reason: string; blockId?: string };

// Worker -> Content script
export type GenerateReq =
  | { type: 'PING' }
  | { type: 'GENERATE'; requestId: string; prompt: string; kind: ResolvedKind; aspectRatio: AspectRatio }
  | { type: 'ABORT'; requestId: string };

// Content script -> Worker
export type GenerateRes =
  | { type: 'PONG'; provider: Provider; loggedIn: boolean }
  | { type: 'GENERATE_RESULT'; requestId: string; ok: true; mediaUrl: string; mediaType: 'png' | 'mp4' }
  | { type: 'GENERATE_ERROR'; requestId: string; ok: false; errorType: ErrorType; message: string };

export interface BatchSummary {
  total: number; done: number; failed: number; skipped: number;
  failedBlockIds: string[];
  folder: string;
}
```

## Storage keys (src/shared/constants.ts)

```ts
export const STORAGE_KEYS = {
  BATCH_STATE: 'avg.batchState',      // BatchState hiện tại (resume)
  LAST_CONFIG: 'avg.lastConfig',      // RunConfig gần nhất (prefill UI)
  SELECTOR_OVERRIDES: 'avg.selectors' // override selector profile (06)
} as const;
```

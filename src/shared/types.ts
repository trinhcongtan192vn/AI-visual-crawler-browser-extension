// 03 — Data Models. Hợp đồng dữ liệu giữa panel, worker, content script.

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
  skip?: boolean;            // true nếu visualFx rỗng — không đủ mô tả để tạo
  skipReason?: string;
}

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

export interface Job {
  blockId: string;
  kind: ResolvedKind;            // kind thực thi (có thể bị hạ cấp, xem dưới)
  originalKind: ResolvedKind;    // kind gốc từ Excel
  downgraded: boolean;           // true nếu video→image do provider=chatgpt
  prompt: string;                // prompt cuối cùng (đã ghép template + prefix/suffix)
  promptEditedByUser?: boolean;  // true nếu user đã sửa tay ở Preview
  status: JobStatus;
  attempts: number;
  lastError?: { type: ErrorType; message: string };
  outputFileName?: string;       // sau khi tải xong
  outputMediaType?: 'png' | 'mp4';
  startedAt?: number;
  finishedAt?: number;
}

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
  manifestRecords: ManifestRecord[];
}

export interface ManifestRecord {
  blockId: string;
  originalKind: ResolvedKind;
  executedKind: ResolvedKind;
  downgraded: boolean;
  provider: Provider;
  aspectRatio: AspectRatio;
  status: JobStatus;
  attempts: number;
  outputFileName?: string;
  errorType?: ErrorType;
  promptUsed: string;
  timestamp: number;
}

export interface BatchSummary {
  total: number;
  done: number;
  failed: number;
  skipped: number;
  failedBlockIds: string[];
  folder: string;
}

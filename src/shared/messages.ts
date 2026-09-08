import type { AspectRatio, BatchState, BatchStatus, BatchSummary, ErrorType, Job, Provider, ResolvedKind, RunConfig } from './types';

// Panel -> Worker (port: avg-control)
// Lưu ý: START_BATCH nhận `jobs` (đã build prompt + xử lý downgrade + chỉnh tay của user ở
// Preview) thay vì `blocks` thô — panel là nơi duy nhất build prompt (04), worker chỉ thực thi.
export type ControlMsg =
  | { type: 'START_BATCH'; jobs: Job[]; config: RunConfig }
  | { type: 'PAUSE_BATCH' }
  | { type: 'RESUME_BATCH' }
  | { type: 'RETRY_JOB'; blockId: string }
  | { type: 'RETRY_ALL_FAILED' }
  | { type: 'CANCEL_BATCH' }
  | { type: 'GET_STATE' }
  | { type: 'EXPORT_MANIFEST' };

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
  | { type: 'ABORT'; requestId: string }
  // Dùng cho đường tải B (07.2): worker đã "vũ trang" chrome.downloads.onDeterminingFilename,
  // giờ ra lệnh content script bấm nút tải chuyên dụng của trang.
  | { type: 'TRIGGER_DOWNLOAD'; requestId: string };

// Content script -> Worker
export type GenerateRes =
  | { type: 'PONG'; provider: Provider; loggedIn: boolean }
  | { type: 'GENERATE_RESULT'; requestId: string; ok: true; mediaUrl: string; mediaType: 'png' | 'mp4'; captureMode: 'url' | 'page-triggered' }
  | { type: 'GENERATE_ERROR'; requestId: string; ok: false; errorType: ErrorType; message: string }
  | { type: 'DOWNLOAD_TRIGGERED'; requestId: string; ok: boolean };

export const PORT_NAME = 'avg-control';

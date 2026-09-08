export const STORAGE_KEYS = {
  BATCH_STATE: 'avg.batchState',      // BatchState hiện tại (resume)
  LAST_CONFIG: 'avg.lastConfig',      // RunConfig gần nhất (prefill UI)
  SELECTOR_OVERRIDES: 'avg.selectors' // override selector profile (06)
} as const;

export const TIMEOUTS = {
  ping: 3_000,
  promptInputReady: 15_000,
  generationStart: 20_000,     // từ lúc gửi tới lúc thấy dấu hiệu "đang chạy"
  imageDone: 120_000,          // chờ ảnh xong
  videoDone: 360_000,          // chờ video Veo xong (render lâu) — có thể tăng
  downloadComplete: 60_000,
  pageTriggeredCapture: 20_000 // chờ bắt file do trang tự tải (07 đường B)
};

export const MAX_AUTO_RETRY = 2;                 // tổng 3 lần thử
export const RETRY_BACKOFF = [0, 5000, 15000];   // ms theo lần attempt (index = attempts)

export const DEFAULT_INTER_BLOCK_DELAY = { min: 3000, max: 8000 };

export const CONSECUTIVE_ANOMALY_THRESHOLD = 3; // N job liên tiếp lỗi bất thường -> needs_attention

export const LOG_PREFIX = '[AVG]';

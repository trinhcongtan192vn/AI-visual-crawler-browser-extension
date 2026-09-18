// 06.2 — Selector profiles. TÁCH RIÊNG khỏi logic để vá nóng qua chrome.storage.local
// (key SELECTOR_OVERRIDES) mà không cần build lại.
//
// ⚠️ QUAN TRỌNG: các mảng selector dưới đây là ƯỚC LƯỢNG dựa trên cấu trúc DOM phổ biến
// của chatgpt.com / gemini.google.com tại thời điểm soạn thảo, CHƯA được xác minh trực tiếp
// trên trang thật (môi trường này không truy cập được web trực tiếp). Trước khi chạy batch
// thật, BẮT BUỘC làm theo 06.7: mở trang thật, dùng DevTools xác định selector ổn định
// (ưu tiên data-*, aria-label, role), rồi cập nhật file này hoặc nạp override qua storage.
//
// Mỗi vai trò là MẢNG fallback — hệ thống thử lần lượt tới khi khớp (xem dom-utils.queryFirst).
// Với các trường "marker" (loggedOutMarker, rateLimitMarker, errorMarker, generatingMarker),
// một entry có khoảng trắng được hiểu là cụm văn bản để so khớp trong innerText (xem matchers.ts),
// còn lại được thử như CSS selector trước.

export interface SelectorProfile {
  version: string;
  verifiedAt: string;
  chatgpt: {
    promptInput: string[];
    sendButton: string[];
    resultImage: string[];
    downloadButton: string[];
    loggedOutMarker: string[];
    rateLimitMarker: string[];
    errorMarker: string[];
    generatingMarker: string[];
    turnContainer: string[];
  };
  gemini: {
    promptInput: string[];
    sendButton: string[];
    modelSwitcher: string[];
    veoOption: string[];
    imageModelOption: string[];
    aspectRatioControl: string[];
    resultImage: string[];
    resultVideo: string[];
    imageDownloadButton: string[];
    videoDownloadButton: string[];
    loggedOutMarker: string[];
    rateLimitMarker: string[];
    errorMarker: string[];
    generatingMarker: string[];
    turnContainer: string[];
  };
}

export const DEFAULT_SELECTORS: SelectorProfile = {
  version: 'unverified-0.1',
  verifiedAt: 'CHƯA XÁC MINH — cập nhật ngày sau khi kiểm chứng trên trang thật',
  chatgpt: {
    promptInput: [
      '#prompt-textarea',
      'div#prompt-textarea[contenteditable="true"]',
      'form [contenteditable="true"]',
      'textarea[data-id="root"]',
      'main form textarea'
    ],
    sendButton: [
      '[data-testid="send-button"]',
      'button[aria-label="Send prompt"]',
      'button[aria-label="Send message"]',
      'form button[type="submit"]'
    ],
    resultImage: [
      // Xác nhận trực tiếp trên chatgpt.com ngày 2026-09-08 — ChatGPT đổi domain ảnh sang
      // backend-api/estuary/content (không còn files.oaiusercontent.com như trước).
      'img[src*="backend-api/estuary/content"]',
      '[data-message-author-role="assistant"] img[src*="files.oaiusercontent.com"]',
      '[data-message-author-role="assistant"] img.result-image',
      '[data-message-author-role="assistant"] img'
    ],
    // ⚠️ Chưa xác nhận trực tiếp — soi DOM không thấy nút có aria-label "download"/"tải".
    // Có 2 container overlay hiện khi hover ảnh: data-testid="image-gen-overlay-left-actions"
    // và "-right-actions" (xác nhận tồn tại), nút tải nhiều khả năng nằm trong đó nhưng chưa
    // biết chính xác aria-label/icon. Nếu các matcher này không khớp, code tự fallback sang
    // lấy <img src> (đã hoạt động, có thể là bản nén — xem 06.6).
    downloadButton: [
      '[data-testid="image-gen-overlay-right-actions"] a[download]',
      '[data-testid="image-gen-overlay-left-actions"] a[download]',
      '[data-testid="image-gen-overlay-right-actions"] button[aria-label*="Download" i]',
      '[data-testid="image-gen-overlay-left-actions"] button[aria-label*="Download" i]',
      '[data-message-author-role="assistant"] a[download]',
      'button[aria-label="Download"]',
      'button[aria-label*="Tải xuống"]'
    ],
    loggedOutMarker: [
      'button[data-testid="login-button"]',
      'Log in',
      'Đăng nhập'
    ],
    rateLimitMarker: [
      'You have reached your limit',
      'you\'ve hit the limit',
      'try again later',
      'đã đạt giới hạn',
      'hết lượt'
    ],
    errorMarker: [
      '.text-red-500',
      'unable to generate',
      'không thể tạo',
      'something went wrong'
    ],
    generatingMarker: [
      'button[aria-label="Stop generating"]',
      'button[aria-label="Dừng tạo"]',
      '.result-streaming'
    ],
    turnContainer: [
      'main [data-testid^="conversation-turn-"]',
      'main div[role="presentation"] > div'
    ]
  },
  gemini: {
    promptInput: [
      // Xác nhận trực tiếp trên gemini.google.com/app ngày 2026-09-08 (xem đầu selector).
      'div.ql-editor[aria-label="Enter a prompt for Gemini"]',
      'rich-textarea .ql-editor',
      'div[contenteditable="true"][aria-label*="prompt" i]',
      'div.ql-editor[contenteditable="true"]'
    ],
    // ⚠️ CHƯA xác nhận trên trang thật — không khớp trong lần soi DOM đầu (nút không có
    // aria-label chứa "send"/"gửi"). Đang chờ user gửi lại kết quả soi trực tiếp nút gửi.
    sendButton: [
      'button[aria-label="Send message"]',
      'button[aria-label="Gửi"]',
      'button.send-button'
    ],
    modelSwitcher: [
      // Xác nhận: aria-label thật dạng "Open mode picker, currently Gemini Flash".
      'button[aria-label*="mode picker" i]',
      'button[aria-label*="model"]',
      '.model-switcher-button',
      'button[aria-label*="Chọn mô hình"]'
    ],
    veoOption: [
      '[data-test-id*="veo"]',
      'li:has(> span:contains("Veo"))',
      'Veo'
    ],
    imageModelOption: [
      '[data-test-id*="image"]',
      'Imagen'
    ],
    aspectRatioControl: [
      'button[aria-label*="Aspect ratio"]',
      'button[aria-label*="Tỷ lệ khung hình"]'
    ],
    resultImage: [
      'generated-image img',
      'img[alt*="Generated image"]',
      '[data-test-id="image-content"] img'
    ],
    resultVideo: [
      'video[src]',
      '[data-test-id="video-content"] video',
      'video-player video'
    ],
    imageDownloadButton: [
      // Xác nhận trực tiếp trên gemini.google.com/app ngày 2026-09-19 (hover ảnh để hiện nút).
      'button[aria-label="Download full size image"]',
      'button[aria-label="Download image"]',
      'button[aria-label*="Tải ảnh"]',
      'a[download][href*="googleusercontent"]'
    ],
    videoDownloadButton: [
      'button[aria-label="Download video"]',
      'button[aria-label*="Tải video"]',
      'a[download][href*=".mp4"]'
    ],
    loggedOutMarker: [
      'a[href*="accounts.google.com"]',
      'Sign in',
      'Đăng nhập'
    ],
    rateLimitMarker: [
      'You\'ve reached your limit',
      'reached your limit for video generation',
      'hết lượt tạo video',
      'đã đạt giới hạn',
      'try again later'
    ],
    errorMarker: [
      '.error-message',
      'something went wrong',
      'không thể tạo',
      'unable to generate'
    ],
    generatingMarker: [
      '.loading-indicator',
      '[data-test-id="loading"]',
      'đang tạo video',
      'generating'
    ],
    turnContainer: [
      '[data-test-id="conversation-turn"]',
      'model-response'
    ]
  }
};

/** Deep merge override (từ storage) đè lên DEFAULT_SELECTORS. Mảng override THAY THẾ hoàn toàn mảng gốc. */
export function mergeSelectorOverrides(
  base: SelectorProfile,
  override: Partial<SelectorProfile> | null | undefined
): SelectorProfile {
  if (!override) return base;
  const merged: any = { ...base };
  for (const provider of ['chatgpt', 'gemini'] as const) {
    if (override[provider]) {
      merged[provider] = { ...base[provider], ...(override[provider] as object) };
    }
  }
  if (override.version) merged.version = override.version;
  if (override.verifiedAt) merged.verifiedAt = override.verifiedAt;
  return merged as SelectorProfile;
}

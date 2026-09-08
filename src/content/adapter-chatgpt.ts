// 06.4 — Adapter ChatGPT. Chỉ ẢNH; video lọt tới đây bị chặn (downgrade lẽ ra đã xử lý ở worker).
import type { AspectRatio, ResolvedKind } from '../shared/types';
import { AdapterError, type GenerateOutcome, type ProviderAdapter } from './adapter-base';
import { DEFAULT_SELECTORS, mergeSelectorOverrides, type SelectorProfile } from './selectors';
import {
  blobUrlToDataUrl,
  humanClick,
  markerPresent,
  queryAll,
  queryFirst,
  registerDownloadTrigger,
  setPromptText,
  waitFor,
  waitForEnabledButton
} from './dom-utils';
import { TIMEOUTS } from '../shared/constants';
import { createLogger } from '../shared/logger';

const log = createLogger('adapter-chatgpt');

export class ChatGptAdapter implements ProviderAdapter {
  provider = 'chatgpt' as const;

  private selectors(overrides: Partial<SelectorProfile> | null): SelectorProfile['chatgpt'] {
    return mergeSelectorOverrides(DEFAULT_SELECTORS, overrides).chatgpt;
  }

  isLoggedIn(overrides: Partial<SelectorProfile> | null = null): boolean {
    const sel = this.selectors(overrides);
    // Xem giải thích ở adapter-gemini.ts: chỉ dựa vào loggedOutMarker, không bắt buộc
    // promptInput để tránh false negative do selector chưa xác minh (06.7) dừng oan cả batch.
    return !markerPresent(sel.loggedOutMarker);
  }

  async generate(req: {
    requestId: string;
    prompt: string;
    kind: ResolvedKind;
    aspectRatio: AspectRatio;
    signal: AbortSignal;
    selectorOverrides?: Partial<SelectorProfile> | null;
  }): Promise<GenerateOutcome> {
    if (req.kind === 'video') {
      throw new AdapterError('UNSUPPORTED', 'ChatGPT không hỗ trợ tạo video (đáng lẽ đã downgrade ở worker)');
    }
    const sel = this.selectors(req.selectorOverrides ?? null);
    const { signal } = req;

    const input = await waitFor(() => queryFirst(sel.promptInput), {
      timeoutMs: TIMEOUTS.promptInputReady,
      signal
    }).catch(() => {
      throw new AdapterError('SELECTOR_MISS', 'Không tìm thấy ô nhập prompt ChatGPT');
    });

    // 06.8 "chống nhầm turn": thay vì dựa vào turnContainer (đã xác nhận không đáng tin trên
    // ChatGPT hiện tại — layout Tailwind lồng sâu, không có wrapper turn ổn định để bắt), ghi
    // lại tập src ảnh đã có TRƯỚC khi gửi, sau đó chỉ chấp nhận ảnh có src MỚI (chưa từng thấy)
    // — cách này không phụ thuộc việc đoán đúng cấu trúc container.
    const priorImageSrcs = new Set(queryAll(sel.resultImage).map((el) => (el as HTMLImageElement).src));

    setPromptText(input, req.prompt);

    // Chờ nút gửi enable thay vì sleep cố định (nhiều app chỉ enable sau khi nhận input,
    // xem giải thích chi tiết ở adapter-gemini.ts — cùng vấn đề, khác trang).
    const sendBtn = await waitForEnabledButton(sel.sendButton, { timeoutMs: 5_000, signal });
    if (sendBtn) {
      humanClick(sendBtn);
    } else {
      log.warn('Không tìm/enable được sendButton trong 5s, fallback gửi bằng phím Enter');
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    }

    // Chờ bắt đầu chạy (best-effort — nếu render quá nhanh có thể bỏ lỡ marker).
    await waitFor(() => (markerPresent(sel.generatingMarker) ? true : null), {
      timeoutMs: TIMEOUTS.generationStart,
      signal
    }).catch(() => log.warn('generatingMarker không xuất hiện trong generationStart, tiếp tục chờ kết quả'));

    const img = await waitFor(
      () => {
        if (markerPresent(sel.rateLimitMarker)) throw new AdapterError('RATE_LIMIT', 'ChatGPT báo đã đạt giới hạn');
        if (markerPresent(sel.errorMarker, document)) {
          throw new AdapterError('PROVIDER_ERROR', 'ChatGPT báo lỗi khi tạo ảnh');
        }
        const stillGenerating = markerPresent(sel.generatingMarker);
        if (stillGenerating) return null;
        const fresh = queryAll(sel.resultImage).find((el) => !priorImageSrcs.has((el as HTMLImageElement).src));
        return (fresh as HTMLImageElement | undefined) ?? null;
      },
      { timeoutMs: TIMEOUTS.imageDone, signal }
    ).catch((err) => {
      if (err instanceof AdapterError) throw err;
      throw new AdapterError('TIMEOUT', 'Hết thời gian chờ ChatGPT tạo ảnh xong');
    });

    // Nút tải chuyên dụng cũng tìm trên toàn trang (không scope theo turn) vì cùng lý do trên.
    const downloadBtn = queryFirst(sel.downloadButton);
    if (downloadBtn instanceof HTMLAnchorElement && downloadBtn.href) {
      return { mediaUrl: downloadBtn.href, mediaType: 'png', captureMode: 'url' };
    }
    if (downloadBtn) {
      registerDownloadTrigger(req.requestId, () => humanClick(downloadBtn));
      return { mediaUrl: '', mediaType: 'png', captureMode: 'page-triggered' };
    }

    if (!img?.src) {
      throw new AdapterError('SELECTOR_MISS', 'Không lấy được ảnh kết quả từ ChatGPT');
    }
    log.warn('Không có nút tải chuyên dụng, dùng <img src> — có thể là bản preview nén (06.6)');
    const dataUrl = await blobUrlToDataUrl(img.src);
    return { mediaUrl: dataUrl, mediaType: 'png', captureMode: 'url' };
  }
}

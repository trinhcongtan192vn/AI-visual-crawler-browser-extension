// 06.5 — Adapter Gemini. Ảnh + Video (Veo). Video không cần chọn model riêng (xác nhận thực
// tế — chỉ cần đúng nội dung prompt), chỉ khác ảnh ở chỗ chờ lâu hơn và phân biệt "đang
// render" vs "treo" (09.2).
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
  sleep,
  waitFor,
  waitForEnabledButton
} from './dom-utils';
import { TIMEOUTS } from '../shared/constants';
import { createLogger } from '../shared/logger';

const log = createLogger('adapter-gemini');

/**
 * Xác nhận thực tế: ảnh Gemini tạo ra được phục vụ qua lh3.googleusercontent.com với hậu tố
 * kích thước dạng "=s1024-rj" ở cuối URL (quy ước resize ảnh của Google). Thay bằng "=s0"
 * (quy ước "kích thước gốc, không co") để lấy thẳng bản gốc qua URL — KHÔNG cần bấm nút tải.
 * Đáng tin hơn hẳn đường "trang tự tải" (page-triggered): đã xác nhận nút tải giả lập bằng
 * dispatchEvent KHÔNG kích hoạt được logic tải thật của Gemini (rất có thể trang kiểm tra
 * event.isTrusted) — kiểm chứng bằng chrome://downloads không hề xuất hiện file nào sau khi bấm.
 */
function toFullSizeGoogleUserContentUrl(src: string): string | null {
  if (!/googleusercontent\.com/.test(src)) return null;
  if (/=s\d+(-[\w]+)?$/.test(src)) {
    return src.replace(/=s\d+(-[\w]+)?$/, '=s0');
  }
  return `${src}=s0`;
}

export class GeminiAdapter implements ProviderAdapter {
  provider = 'gemini' as const;

  private selectors(overrides: Partial<SelectorProfile> | null): SelectorProfile['gemini'] {
    return mergeSelectorOverrides(DEFAULT_SELECTORS, overrides).gemini;
  }

  isLoggedIn(overrides: Partial<SelectorProfile> | null = null): boolean {
    const sel = this.selectors(overrides);
    // Chỉ dựa vào dấu hiệu ĐÃ đăng xuất (loggedOutMarker), KHÔNG bắt buộc phải tìm thấy
    // promptInput — vì promptInput là selector chưa xác minh trên trang thật (06.7), false
    // negative ở đây sẽ dừng oan cả batch. Nếu selector promptInput thật sự sai, lỗi đó vẫn
    // lộ ra ở generate() dưới dạng SELECTOR_MISS cấp block (retry được), an toàn hơn nhiều
    // so với halt cả batch với thông báo sai "chưa đăng nhập".
    return !markerPresent(sel.loggedOutMarker);
  }

  private async trySetAspectRatio(sel: SelectorProfile['gemini'], aspectRatio: AspectRatio, signal: AbortSignal) {
    const control = queryFirst(sel.aspectRatioControl);
    if (!control) return false;
    humanClick(control);
    await sleep(300, signal);
    const options = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"], [role="option"], button'));
    const target = aspectRatio.replace(/\s+/g, '');
    const match = options.find((o) => (o.textContent ?? '').replace(/\s+/g, '').includes(target));
    if (!match) return false;
    humanClick(match);
    await sleep(200, signal);
    return true;
  }

  /** Gõ text vào ô nhập rồi bấm gửi (dùng chung cho generate() và sendContext()). */
  private async typeAndSend(sel: SelectorProfile['gemini'], input: HTMLElement, text: string, signal: AbortSignal): Promise<void> {
    setPromptText(input, text);
    // Nút gửi của Gemini bị disabled khi ô prompt rỗng và chỉ enable sau khi Angular nhận
    // input (không phải tức thì) — chờ có điều kiện thay vì sleep cố định (xác nhận thực tế
    // trên trang: button[aria-label="Send message"] disabled=false chỉ sau khi có text).
    const sendBtn = await waitForEnabledButton(sel.sendButton, { timeoutMs: 5_000, signal });
    if (sendBtn) {
      humanClick(sendBtn);
    } else {
      log.warn('Không tìm/enable được sendButton trong 5s, fallback gửi bằng phím Enter');
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    }
  }

  async sendContext(req: {
    text: string;
    signal: AbortSignal;
    selectorOverrides?: Partial<SelectorProfile> | null;
  }): Promise<void> {
    const sel = this.selectors(req.selectorOverrides ?? null);
    const { signal } = req;

    const input = await waitFor(() => queryFirst(sel.promptInput), {
      timeoutMs: TIMEOUTS.promptInputReady,
      signal
    }).catch(() => {
      throw new AdapterError('SELECTOR_MISS', 'Không tìm thấy ô nhập prompt Gemini (gửi ngữ cảnh đầu phiên)');
    });

    await this.typeAndSend(sel, input, req.text, signal);

    await waitFor(() => (markerPresent(sel.generatingMarker) ? true : null), {
      timeoutMs: TIMEOUTS.generationStart,
      signal
    }).catch(() => log.warn('generatingMarker không xuất hiện khi gửi ngữ cảnh, tiếp tục chờ trả lời xong'));

    // Best-effort — không cần đọc nội dung trả lời, chỉ để không gửi chồng block đầu tiên
    // lên trong lúc Gemini còn đang trả lời tin ngữ cảnh.
    await waitFor(
      () => {
        if (markerPresent(sel.rateLimitMarker)) throw new AdapterError('RATE_LIMIT', 'Gemini báo đã đạt giới hạn');
        if (markerPresent(sel.errorMarker)) {
          throw new AdapterError('PROVIDER_ERROR', 'Gemini báo lỗi khi nhận tin nhắn ngữ cảnh');
        }
        return markerPresent(sel.generatingMarker, document) ? null : true;
      },
      { timeoutMs: TIMEOUTS.contextMessageDone, signal }
    ).catch((err) => {
      if (err instanceof AdapterError) throw err;
      log.warn('Không xác nhận được Gemini đã trả lời xong tin nhắn ngữ cảnh trong thời gian chờ, vẫn tiếp tục batch');
    });
  }

  async generate(req: {
    requestId: string;
    prompt: string;
    kind: ResolvedKind;
    aspectRatio: AspectRatio;
    signal: AbortSignal;
    selectorOverrides?: Partial<SelectorProfile> | null;
  }): Promise<GenerateOutcome> {
    const sel = this.selectors(req.selectorOverrides ?? null);
    const { signal, kind } = req;

    // Xác nhận thực tế: không cần chọn model — chỉ cần đúng nội dung prompt (video template ở
    // 04) là Gemini tự tạo video, không có bước chọn "Veo" riêng như giả định ban đầu của PRD.

    const input = await waitFor(() => queryFirst(sel.promptInput), {
      timeoutMs: TIMEOUTS.promptInputReady,
      signal
    }).catch(() => {
      throw new AdapterError('SELECTOR_MISS', 'Không tìm thấy ô nhập prompt Gemini');
    });

    await this.trySetAspectRatio(sel, req.aspectRatio, signal).catch((err) => {
      log.warn('trySetAspectRatio lỗi, dựa vào hint trong prompt thay thế', err);
    });

    const turnsBefore = queryAll(sel.turnContainer).length;

    await this.typeAndSend(sel, input, req.prompt, signal);

    await waitFor(() => (markerPresent(sel.generatingMarker) ? true : null), {
      timeoutMs: TIMEOUTS.generationStart,
      signal
    }).catch(() => log.warn('generatingMarker không xuất hiện trong generationStart, tiếp tục chờ kết quả'));

    const newestTurn = await waitFor(
      () => {
        const containers = queryAll(sel.turnContainer);
        return containers.length > turnsBefore ? containers[containers.length - 1] : null;
      },
      { timeoutMs: kind === 'video' ? TIMEOUTS.videoDone : TIMEOUTS.imageDone, signal }
    ).catch(() => {
      throw new AdapterError('TIMEOUT', 'Không thấy turn phản hồi mới của Gemini');
    });

    const resultSelector = kind === 'video' ? sel.resultVideo : sel.resultImage;
    const baseTimeout = kind === 'video' ? TIMEOUTS.videoDone : TIMEOUTS.imageDone;

    const resultEl = await this.waitForDone(sel, resultSelector, newestTurn, baseTimeout, signal, kind);

    if (kind === 'image') {
      const img = resultEl as HTMLImageElement;
      if (!img?.src) throw new AdapterError('SELECTOR_MISS', 'Không lấy được ảnh kết quả từ Gemini');

      // Ưu tiên: đổi thẳng URL ảnh (<img src>) sang kích thước gốc — xác nhận đáng tin hơn
      // hẳn việc bấm nút tải (nút tải giả lập KHÔNG kích hoạt được logic tải thật của Gemini,
      // nghi do trang kiểm tra event.isTrusted — xác nhận qua chrome://downloads không hề
      // xuất hiện file nào sau khi bấm). Không cần round-trip message, không phụ thuộc DOM
      // còn sống hay không tại thời điểm bấm.
      const fullSizeUrl = toFullSizeGoogleUserContentUrl(img.src);
      if (fullSizeUrl) {
        return { mediaUrl: fullSizeUrl, mediaType: 'png', captureMode: 'url' };
      }

      const downloadBtn = queryFirst(sel.imageDownloadButton, newestTurn);
      if (downloadBtn instanceof HTMLAnchorElement && downloadBtn.href) {
        return { mediaUrl: downloadBtn.href, mediaType: 'png', captureMode: 'url' };
      }
      if (downloadBtn) {
        registerDownloadTrigger(req.requestId, () => {
          const freshBtn = queryFirst(sel.imageDownloadButton, newestTurn) ?? downloadBtn;
          humanClick(freshBtn);
        });
        return { mediaUrl: '', mediaType: 'png', captureMode: 'page-triggered' };
      }

      log.warn('Không đổi được URL sang kích thước gốc và không có nút tải chuyên dụng, dùng <img src> — có thể là bản preview nén (06.6)');
      const dataUrl = await blobUrlToDataUrl(img.src);
      return { mediaUrl: dataUrl, mediaType: 'png', captureMode: 'url' };
    }

    // video
    const video = resultEl as HTMLVideoElement;
    const videoSrc = video?.currentSrc || video?.src;

    // Xác nhận thực tế: <video>.currentSrc của Gemini là URL tải trực tiếp thật, KHÔNG phải
    // blob: — dạng contribution.usercontent.google.com/download?...&filename=video.mp4 — tải
    // thẳng qua chrome.downloads.download được, không cần bấm nút (cùng lý do bỏ qua nút tải
    // ảnh: click giả lập không kích hoạt được logic tải thật của trang — xem 06.6/adapter-gemini
    // phần ảnh).
    if (videoSrc && !videoSrc.startsWith('blob:')) {
      return { mediaUrl: videoSrc, mediaType: 'mp4', captureMode: 'url' };
    }

    const downloadBtn = queryFirst(sel.videoDownloadButton, newestTurn);
    if (downloadBtn instanceof HTMLAnchorElement && downloadBtn.href) {
      return { mediaUrl: downloadBtn.href, mediaType: 'mp4', captureMode: 'url' };
    }
    if (downloadBtn) {
      registerDownloadTrigger(req.requestId, () => {
        const freshBtn = queryFirst(sel.videoDownloadButton, newestTurn) ?? downloadBtn;
        humanClick(freshBtn);
      });
      return { mediaUrl: '', mediaType: 'mp4', captureMode: 'page-triggered' };
    }

    if (!videoSrc) throw new AdapterError('SELECTOR_MISS', 'Không lấy được video kết quả từ Gemini');
    // Chỉ còn trường hợp blob: tới đây — phải fetch ngay trong content script rồi chuyển base64.
    const dataUrl = await blobUrlToDataUrl(videoSrc);
    return { mediaUrl: dataUrl, mediaType: 'mp4', captureMode: 'url' };
  }

  /**
   * Chờ "render xong" = generatingMarker biến mất VÀ media kết quả xuất hiện trong turn mới (09.3).
   * Với video: nếu vẫn còn generatingMarker khi chạm timeout gốc, gia hạn thêm một nhịp (09.2)
   * thay vì báo TIMEOUT ngay — để tránh timeout oan khi render vẫn đang tiến triển.
   */
  private async waitForDone(
    sel: SelectorProfile['gemini'],
    resultSelectors: string[],
    scope: HTMLElement,
    timeoutMs: number,
    signal: AbortSignal,
    kind: ResolvedKind
  ): Promise<HTMLElement> {
    const check = () => {
      // Giới hạn vào ĐÚNG turn mới nhất — không quét cả trang (xem giải thích chi tiết ở
      // markerPresent trong dom-utils.ts): tránh bắt nhầm lỗi CŨ còn sót lại trong lịch sử
      // chat từ một block trước đó là lỗi của block hiện tại.
      if (markerPresent(sel.rateLimitMarker, scope)) throw new AdapterError('RATE_LIMIT', 'Gemini báo đã đạt giới hạn');
      if (markerPresent(sel.errorMarker, scope)) throw new AdapterError('PROVIDER_ERROR', 'Gemini báo lỗi khi tạo');
      const stillGenerating = markerPresent(sel.generatingMarker, document);
      const el = queryFirst(resultSelectors, scope);
      return !stillGenerating && el ? el : null;
    };

    try {
      return await waitFor(check, { timeoutMs, signal });
    } catch (err) {
      if (err instanceof AdapterError) throw err;
      if (kind === 'video' && markerPresent(sel.generatingMarker, document)) {
        log.info('Video vẫn đang render khi chạm timeout gốc, gia hạn thêm một nhịp');
        try {
          return await waitFor(check, { timeoutMs, signal });
        } catch (err2) {
          if (err2 instanceof AdapterError) throw err2;
          throw new AdapterError('TIMEOUT', 'Hết thời gian chờ Gemini render video (đã gia hạn)');
        }
      }
      throw new AdapterError('TIMEOUT', `Hết thời gian chờ Gemini tạo ${kind === 'video' ? 'video' : 'ảnh'} xong`);
    }
  }
}

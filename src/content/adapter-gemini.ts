// 06.5 — Adapter Gemini. Ảnh + Video (Veo). Video: chọn model, chờ lâu hơn, phân biệt
// "đang render" vs "treo" (09.2).
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

  private async ensureModel(sel: SelectorProfile['gemini'], kind: ResolvedKind, signal: AbortSignal) {
    if (kind !== 'video') return; // model ảnh mặc định giả định đã tạo được ảnh (06.5 bước 2)
    const switcher = queryFirst(sel.modelSwitcher);
    if (!switcher) {
      log.warn('Không tìm thấy modelSwitcher — bỏ qua bước chọn Veo, dùng model hiện tại');
      return;
    }
    humanClick(switcher);
    const veoOption = await waitFor(() => queryFirst(sel.veoOption), { timeoutMs: 5_000, signal }).catch(
      () => null
    );
    if (!veoOption) {
      throw new AdapterError('SELECTOR_MISS', 'Không tìm thấy tùy chọn model Veo trong dropdown Gemini');
    }
    humanClick(veoOption);
    await sleep(500, signal);
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

    await this.ensureModel(sel, kind, signal);

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

    setPromptText(input, req.prompt);

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
      const downloadBtn = queryFirst(sel.imageDownloadButton, newestTurn);
      if (downloadBtn instanceof HTMLAnchorElement && downloadBtn.href) {
        return { mediaUrl: downloadBtn.href, mediaType: 'png', captureMode: 'url' };
      }
      if (downloadBtn) {
        registerDownloadTrigger(req.requestId, () => humanClick(downloadBtn));
        return { mediaUrl: '', mediaType: 'png', captureMode: 'page-triggered' };
      }
      const img = resultEl as HTMLImageElement;
      if (!img?.src) throw new AdapterError('SELECTOR_MISS', 'Không lấy được ảnh kết quả từ Gemini');
      log.warn('Không có nút tải ảnh chuyên dụng, dùng <img src> — có thể là bản preview nén (06.6)');
      const dataUrl = await blobUrlToDataUrl(img.src);
      return { mediaUrl: dataUrl, mediaType: 'png', captureMode: 'url' };
    }

    // video
    const downloadBtn = queryFirst(sel.videoDownloadButton, newestTurn);
    if (downloadBtn instanceof HTMLAnchorElement && downloadBtn.href) {
      return { mediaUrl: downloadBtn.href, mediaType: 'mp4', captureMode: 'url' };
    }
    if (downloadBtn) {
      registerDownloadTrigger(req.requestId, () => humanClick(downloadBtn));
      return { mediaUrl: '', mediaType: 'mp4', captureMode: 'page-triggered' };
    }
    const video = resultEl as HTMLVideoElement;
    const src = video?.currentSrc || video?.src;
    if (!src) throw new AdapterError('SELECTOR_MISS', 'Không lấy được video kết quả từ Gemini');
    const dataUrl = await blobUrlToDataUrl(src);
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
      if (markerPresent(sel.rateLimitMarker)) throw new AdapterError('RATE_LIMIT', 'Gemini báo đã đạt giới hạn');
      if (markerPresent(sel.errorMarker)) throw new AdapterError('PROVIDER_ERROR', 'Gemini báo lỗi khi tạo');
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

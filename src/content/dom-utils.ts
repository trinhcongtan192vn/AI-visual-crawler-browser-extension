// 06.3 — DOM utils dùng lại trong các adapter. Mọi thao tác có timeout & abort.
import { createLogger } from '../shared/logger';

const log = createLogger('dom-utils');

export function queryFirst(selectors: string[], root: ParentNode = document): HTMLElement | null {
  for (const sel of selectors) {
    try {
      const el = root.querySelector<HTMLElement>(sel);
      if (el && isVisible(el)) return el;
    } catch (err) {
      log.debug(`invalid selector "${sel}"`, err);
    }
  }
  return null;
}

function isDisabled(el: HTMLElement): boolean {
  return (el as HTMLButtonElement).disabled === true || el.getAttribute('aria-disabled') === 'true';
}

/**
 * Chờ tới khi một trong các selector xuất hiện VÀ không bị disabled (nhiều app Angular/React
 * chỉ enable nút gửi sau khi change detection nhận input, có thể mất hơn một nhịp sleep cố
 * định — xác nhận thực tế trên Gemini: nút "Send message" disabled=true khi ô prompt rỗng).
 */
export async function waitForEnabledButton(
  selectors: string[],
  opts: { timeoutMs: number; signal: AbortSignal; root?: ParentNode; pollMs?: number }
): Promise<HTMLElement | null> {
  try {
    return await waitFor(
      () => {
        const el = queryFirst(selectors, opts.root);
        return el && !isDisabled(el) ? el : null;
      },
      { timeoutMs: opts.timeoutMs, signal: opts.signal, pollMs: opts.pollMs }
    );
  } catch {
    return null;
  }
}

export function queryAll(selectors: string[], root: ParentNode = document): HTMLElement[] {
  for (const sel of selectors) {
    try {
      const els = Array.from(root.querySelectorAll<HTMLElement>(sel));
      if (els.length > 0) return els;
    } catch (err) {
      log.debug(`invalid selector "${sel}"`, err);
    }
  }
  return [];
}

function isVisible(el: HTMLElement): boolean {
  if (!el.isConnected) return false;
  const style = getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse';
}

export class TimeoutError extends Error {}
export class AbortedError extends Error {}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AbortedError('aborted'));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new AbortedError('aborted'));
    });
  });
}

export async function waitFor<T>(
  fn: () => T | null | undefined,
  opts: { timeoutMs: number; signal: AbortSignal; pollMs?: number }
): Promise<T> {
  const { timeoutMs, signal, pollMs = 300 } = opts;
  const start = Date.now();
  while (true) {
    if (signal.aborted) throw new AbortedError('aborted');
    const result = fn();
    if (result) return result;
    if (Date.now() - start > timeoutMs) throw new TimeoutError('waitFor timeout');
    await sleep(pollMs, signal);
  }
}

/** Nhập text an toàn cho contenteditable & textarea. */
export function setPromptText(el: HTMLElement, text: string): void {
  el.focus();
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    const nativeSetter = Object.getOwnPropertyDescriptor(
      el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      'value'
    )?.set;
    nativeSetter?.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }

  // contenteditable (ProseMirror/Lexical/Quill...): xóa nội dung cũ rồi chèn text mới.
  el.focus();
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(el);
  selection?.removeAllRanges();
  selection?.addRange(range);

  let inserted = false;
  try {
    inserted = !!document.execCommand && document.execCommand('insertText', false, text);
  } catch {
    inserted = false;
  }

  const landed = textLanded(el, text);
  if (inserted && landed) {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }

  // ProseMirror (ChatGPT) và một số rich editor khác im lặng bỏ qua execCommand nếu nội
  // dung không đi qua pipeline nhập liệu nội bộ của nó. Paste event thường được các editor
  // này xử lý qua đường chính thức (handlePaste), đáng tin hơn execCommand trực tiếp.
  log.warn('execCommand insertText có vẻ không vào được editor, thử fallback paste event');
  try {
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  } catch (err) {
    log.warn('paste fallback lỗi, dùng cách cuối: ghi trực tiếp textContent', err);
  }

  if (!textLanded(el, text)) {
    // Cách cuối cùng — chấp nhận có thể không tương thích với model nội bộ của editor,
    // nhưng còn hơn để prompt trống hoàn toàn.
    el.textContent = text;
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
  }
}

function textLanded(el: HTMLElement, text: string): boolean {
  const probe = text.trim().slice(0, Math.min(20, text.trim().length));
  if (!probe) return true;
  return (el.textContent ?? '').includes(probe);
}

/** Click "như người": scrollIntoView, dispatch pointer/mouse events. */
export function humanClick(el: HTMLElement): void {
  el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
  const opts = { bubbles: true, cancelable: true, view: window };
  el.dispatchEvent(new PointerEvent('pointerdown', opts));
  el.dispatchEvent(new MouseEvent('mousedown', opts));
  el.dispatchEvent(new PointerEvent('pointerup', opts));
  el.dispatchEvent(new MouseEvent('mouseup', opts));
  el.dispatchEvent(new MouseEvent('click', opts));
}

/**
 * Đăng ký hàm sẽ được gọi khi worker gửi TRIGGER_DOWNLOAD cho requestId này
 * (đường tải B / page-triggered, xem 06.6 & 07.2).
 */
const pendingDownloadTriggers = new Map<string, () => void>();

export function registerDownloadTrigger(requestId: string, fn: () => void): void {
  pendingDownloadTriggers.set(requestId, fn);
}

export function firePendingDownloadTrigger(requestId: string): boolean {
  const fn = pendingDownloadTriggers.get(requestId);
  if (!fn) return false;
  pendingDownloadTriggers.delete(requestId);
  fn();
  return true;
}

export function clearDownloadTrigger(requestId: string): void {
  pendingDownloadTriggers.delete(requestId);
}

/**
 * Kiểm tra một "marker" (loggedOutMarker/rateLimitMarker/errorMarker/generatingMarker).
 * Mỗi entry được thử làm CSS selector trước (querySelector + kiểm tra hiển thị); nếu không
 * khớp, so khớp như cụm văn bản trong textContent của trang (không phân biệt hoa/thường) —
 * vì nhiều banner rate-limit/lỗi/đăng xuất không có selector ổn định.
 */
export function markerPresent(markers: string[], root: Document = document): boolean {
  // Dùng textContent thay vì innerText: không phụ thuộc layout đã tính xong (innerText có thể
  // rỗng nếu gọi trước paint, hoặc trong môi trường test không render như jsdom), nên đáng tin
  // hơn cho việc phát hiện banner/thông báo trên trang thật.
  const bodyText = (root.body?.textContent ?? '').toLowerCase();
  for (const marker of markers) {
    try {
      const el = root.querySelector<HTMLElement>(marker);
      if (el && isVisible(el)) return true;
    } catch {
      // marker là cụm văn bản, không phải CSS selector hợp lệ — rơi xuống so khớp text bên dưới
    }
    if (bodyText.includes(marker.toLowerCase())) return true;
  }
  return false;
}

/**
 * Fetch blob (ảnh/video) và chuyển thành data URL để gửi cho worker tải (06.6 đường 3).
 * Có timeout riêng — fetch()/FileReader không tự timeout, nếu treo sẽ giữ cả generate()
 * "running" vô thời hạn phía content script dù worker có timeout ở tầng message riêng.
 */
export async function blobUrlToDataUrl(url: string, timeoutMs = 30_000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } finally {
    clearTimeout(timer);
  }
}

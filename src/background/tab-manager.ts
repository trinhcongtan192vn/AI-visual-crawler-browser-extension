// 05.8 — Tab manager. Mở/tìm tab provider, ping content script, gửi GENERATE, ABORT.
import type { AspectRatio, Provider, ResolvedKind } from '../shared/types';
import type { GenerateReq, GenerateRes } from '../shared/messages';
import { TIMEOUTS } from '../shared/constants';
import { createLogger } from '../shared/logger';

const log = createLogger('tab-manager');

const PROVIDER_URLS: Record<Provider, string> = {
  chatgpt: 'https://chatgpt.com/',
  gemini: 'https://gemini.google.com/app'
};

const PROVIDER_HOST_PATTERNS: Record<Provider, RegExp> = {
  chatgpt: /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//,
  gemini: /^https:\/\/gemini\.google\.com\//
};

// Chỉ dùng một tab cho mỗi provider (05.8) để tránh phức tạp; xử lý tuần tự.
const knownTabs: Partial<Record<Provider, number>> = {};

async function findExistingTab(provider: Provider): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({});
  return tabs.find((t) => t.url && PROVIDER_HOST_PATTERNS[provider].test(t.url));
}

async function waitTabComplete(tabId: number, timeoutMs = 30_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Tab load timeout'));
    }, timeoutMs);

    function listener(updatedTabId: number, info: chrome.tabs.TabChangeInfo) {
      if (updatedTabId === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }

    chrome.tabs.get(tabId, (tab) => {
      if (tab.status === 'complete') {
        clearTimeout(timer);
        resolve();
        return;
      }
      chrome.tabs.onUpdated.addListener(listener);
    });
  });
}

export async function ensureProviderTab(provider: Provider): Promise<number> {
  const cachedId = knownTabs[provider];
  if (cachedId) {
    try {
      const tab = await chrome.tabs.get(cachedId);
      if (tab && tab.url && PROVIDER_HOST_PATTERNS[provider].test(tab.url)) {
        return cachedId;
      }
    } catch {
      // tab đã đóng, tiếp tục tìm/tạo mới
    }
  }

  const existing = await findExistingTab(provider);
  if (existing?.id) {
    knownTabs[provider] = existing.id;
    if (existing.status !== 'complete') await waitTabComplete(existing.id);
    return existing.id;
  }

  const created = await chrome.tabs.create({ url: PROVIDER_URLS[provider], active: false });
  if (!created.id) throw new Error('Không tạo được tab provider');
  await waitTabComplete(created.id);
  knownTabs[provider] = created.id;
  return created.id;
}

/**
 * Content script chỉ tự inject vào tab được TẢI SAU KHI extension đã cài/reload (theo cách
 * MV3 khai báo content_scripts hoạt động — Chrome không tự chèn lại vào tab đang mở từ trước).
 * Nếu ping() không có phản hồi (no receiving end), chủ động chèn bằng chrome.scripting dựa
 * trên chính danh sách file khai báo trong manifest, để không phải hardcode tên file đã build.
 */
async function injectContentScript(tabId: number): Promise<void> {
  const manifest = chrome.runtime.getManifest();
  const files = manifest.content_scripts?.[0]?.js;
  if (!files || files.length === 0) {
    throw new Error('manifest không khai báo content_scripts.js để inject');
  }
  await chrome.scripting.executeScript({ target: { tabId }, files });
}

async function sendToTab<T extends GenerateRes>(
  tabId: number,
  req: GenerateReq,
  timeoutMs: number
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs);
    chrome.tabs.sendMessage(tabId, req, (response: T) => {
      clearTimeout(timer);
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

export async function ping(tabId: number): Promise<{ ok: boolean; loggedIn: boolean; reason?: string }> {
  try {
    const res = await sendToTab<Extract<GenerateRes, { type: 'PONG' }>>(
      tabId,
      { type: 'PING' },
      TIMEOUTS.ping
    );
    return { ok: true, loggedIn: res?.loggedIn ?? false };
  } catch (err) {
    log.warn('ping failed, thử inject content script rồi ping lại', err);
  }

  try {
    await injectContentScript(tabId);
    await new Promise((r) => setTimeout(r, 300));
    const res = await sendToTab<Extract<GenerateRes, { type: 'PONG' }>>(
      tabId,
      { type: 'PING' },
      TIMEOUTS.ping
    );
    return { ok: true, loggedIn: res?.loggedIn ?? false };
  } catch (err) {
    log.error('ping vẫn thất bại sau khi inject lại', err);
    return { ok: false, loggedIn: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

export async function triggerDownload(tabId: number, requestId: string, timeoutMs = TIMEOUTS.ping): Promise<boolean> {
  try {
    const res = await sendToTab<Extract<GenerateRes, { type: 'DOWNLOAD_TRIGGERED' }>>(
      tabId,
      { type: 'TRIGGER_DOWNLOAD', requestId },
      timeoutMs
    );
    return res?.ok ?? false;
  } catch (err) {
    log.error('triggerDownload failed', err);
    return false;
  }
}

export async function generate(
  tabId: number,
  req: { requestId: string; prompt: string; kind: ResolvedKind; aspectRatio: AspectRatio },
  timeoutMs: number
): Promise<GenerateRes> {
  try {
    const res = await sendToTab<GenerateRes>(
      tabId,
      { type: 'GENERATE', ...req },
      timeoutMs
    );
    return res;
  } catch (err) {
    log.error('generate failed/timeout', err);
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'ABORT', requestId: req.requestId });
    } catch {
      // tab có thể đã đóng
    }
    return { type: 'GENERATE_ERROR', requestId: req.requestId, ok: false, errorType: 'TIMEOUT', message: 'Hết thời gian chờ phản hồi từ content script' };
  }
}

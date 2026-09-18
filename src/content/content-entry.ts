// Entry content script: route theo host, khởi tạo adapter, xử lý PING/GENERATE/ABORT/TRIGGER_DOWNLOAD.
import type { GenerateReq, GenerateRes } from '../shared/messages';
import { AdapterError, type ProviderAdapter } from './adapter-base';
import { ChatGptAdapter } from './adapter-chatgpt';
import { GeminiAdapter } from './adapter-gemini';
import type { SelectorProfile } from './selectors';
import { firePendingDownloadTrigger } from './dom-utils';
import { STORAGE_KEYS } from '../shared/constants';
import { createLogger } from '../shared/logger';
import type { Provider } from '../shared/types';

const log = createLogger('content-entry');

function detectProvider(): Provider | null {
  const host = location.host;
  if (host.includes('chatgpt.com') || host.includes('chat.openai.com')) return 'chatgpt';
  if (host.includes('gemini.google.com')) return 'gemini';
  return null;
}

const provider = detectProvider();
if (!provider) {
  log.debug('Host không khớp provider nào, content script không kích hoạt', location.host);
} else {
  const adapter: ProviderAdapter = provider === 'chatgpt' ? new ChatGptAdapter() : new GeminiAdapter();
  const abortControllers = new Map<string, AbortController>();

  async function getSelectorOverrides(): Promise<Partial<SelectorProfile> | null> {
    try {
      const res = await chrome.storage.local.get(STORAGE_KEYS.SELECTOR_OVERRIDES);
      return (res[STORAGE_KEYS.SELECTOR_OVERRIDES] as Partial<SelectorProfile> | undefined) ?? null;
    } catch (err) {
      log.warn('Không đọc được selector overrides', err);
      return null;
    }
  }

  chrome.runtime.onMessage.addListener((msg: GenerateReq, _sender, sendResponse) => {
    (async () => {
      const overrides = await getSelectorOverrides();

      if (msg.type === 'PING') {
        const loggedIn = adapter.isLoggedIn(overrides);
        const res: GenerateRes = { type: 'PONG', provider: adapter.provider, loggedIn };
        sendResponse(res);
        return;
      }

      if (msg.type === 'ABORT') {
        abortControllers.get(msg.requestId)?.abort();
        abortControllers.delete(msg.requestId);
        return;
      }

      if (msg.type === 'TRIGGER_DOWNLOAD') {
        const ok = firePendingDownloadTrigger(msg.requestId);
        const res: GenerateRes = { type: 'DOWNLOAD_TRIGGERED', requestId: msg.requestId, ok };
        sendResponse(res);
        return;
      }

      if (msg.type === 'SEND_CONTEXT') {
        const controller = new AbortController();
        abortControllers.set(msg.requestId, controller);
        try {
          log.info(`[${msg.requestId}] sendContext start`);
          await adapter.sendContext({ text: msg.text, signal: controller.signal, selectorOverrides: overrides });
          log.info(`[${msg.requestId}] sendContext ok`);
          const res: GenerateRes = { type: 'CONTEXT_SENT', requestId: msg.requestId, ok: true };
          sendResponse(res);
        } catch (err) {
          const errorType = err instanceof AdapterError ? err.errorType : 'UNKNOWN';
          const message = err instanceof Error ? err.message : String(err);
          log.error(`[${msg.requestId}] sendContext failed`, errorType, message);
          const res: GenerateRes = { type: 'CONTEXT_SENT', requestId: msg.requestId, ok: false, errorType, message };
          sendResponse(res);
        } finally {
          abortControllers.delete(msg.requestId);
        }
        return;
      }

      if (msg.type === 'GENERATE') {
        const controller = new AbortController();
        abortControllers.set(msg.requestId, controller);
        try {
          log.info(`[${msg.requestId}] generate start`, { kind: msg.kind });
          const outcome = await adapter.generate({
            requestId: msg.requestId,
            prompt: msg.prompt,
            kind: msg.kind,
            aspectRatio: msg.aspectRatio,
            signal: controller.signal,
            selectorOverrides: overrides
          });
          log.info(`[${msg.requestId}] generate ok`, { captureMode: outcome.captureMode });
          const res: GenerateRes = {
            type: 'GENERATE_RESULT',
            requestId: msg.requestId,
            ok: true,
            mediaUrl: outcome.mediaUrl,
            mediaType: outcome.mediaType,
            captureMode: outcome.captureMode
          };
          sendResponse(res);
        } catch (err) {
          const errorType = err instanceof AdapterError ? err.errorType : 'UNKNOWN';
          const message = err instanceof Error ? err.message : String(err);
          log.error(`[${msg.requestId}] generate failed`, errorType, message);
          const res: GenerateRes = { type: 'GENERATE_ERROR', requestId: msg.requestId, ok: false, errorType, message };
          sendResponse(res);
        } finally {
          abortControllers.delete(msg.requestId);
        }
      }
    })();
    return true; // giữ kênh mở cho sendResponse bất đồng bộ
  });

  log.info(`Content script sẵn sàng cho provider=${provider}`);
}

// Entry background. Nối port panel<->worker, route ControlMsg, khởi động recovery (05.7).
import { PORT_NAME, type ControlMsg, type ProgressMsg } from '../shared/messages';
import { createLogger } from '../shared/logger';
import * as queueEngine from './queue-engine';

const log = createLogger('service-worker');

chrome.runtime.onInstalled.addListener(() => {
  log.info('AI Visual Generator installed');
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err) => log.warn('setPanelBehavior failed', err));
});

chrome.alarms.onAlarm.addListener((alarm) => queueEngine.handleAlarm(alarm));

const ports = new Set<chrome.runtime.Port>();

queueEngine.setBroadcaster((msg: ProgressMsg) => {
  for (const port of ports) {
    try {
      port.postMessage(msg);
    } catch (err) {
      log.warn('post to port failed', err);
    }
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PORT_NAME) return;
  ports.add(port);
  log.debug('panel connected');

  port.onMessage.addListener(async (msg: ControlMsg) => {
    try {
      await handleControlMsg(msg, port);
    } catch (err) {
      log.error('handleControlMsg error', err);
    }
  });

  port.onDisconnect.addListener(() => {
    ports.delete(port);
    log.debug('panel disconnected');
  });
});

async function handleControlMsg(msg: ControlMsg, port: chrome.runtime.Port): Promise<void> {
  switch (msg.type) {
    case 'START_BATCH':
      await queueEngine.startBatch(msg.jobs, msg.config);
      break;
    case 'PAUSE_BATCH':
      await queueEngine.pauseBatch();
      break;
    case 'RESUME_BATCH':
      await queueEngine.resumeBatch();
      break;
    case 'RETRY_JOB':
      await queueEngine.retryJob(msg.blockId);
      break;
    case 'RETRY_ALL_FAILED':
      await queueEngine.retryAllFailed();
      break;
    case 'CANCEL_BATCH':
      await queueEngine.cancelBatch();
      break;
    case 'EXPORT_MANIFEST':
      await queueEngine.exportManifest();
      break;
    case 'GET_STATE': {
      const batch = queueEngine.getBatch();
      const res: ProgressMsg = { type: 'STATE_SNAPSHOT', batch };
      port.postMessage(res);
      break;
    }
  }
}

chrome.runtime.onStartup.addListener(() => {
  queueEngine.recoverOnStartup().catch((err) => log.error('recoverOnStartup failed', err));
});

// Worker cũng có thể "hồi sinh" khi nhận message đầu tiên sau khi bị suspend — chạy recovery luôn khi module load.
queueEngine.recoverOnStartup().catch((err) => log.error('recoverOnStartup (module load) failed', err));

log.info('service worker script loaded');

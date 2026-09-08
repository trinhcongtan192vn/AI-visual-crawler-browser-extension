// 08.6 — Kết nối port avg-control tới worker. Reconnect nếu port đứt (worker suspend).
import { PORT_NAME, type ControlMsg, type ProgressMsg } from '../shared/messages';
import { createLogger } from '../shared/logger';

const log = createLogger('panel-port');

type Listener = (msg: ProgressMsg) => void;

let port: chrome.runtime.Port | null = null;
const listeners = new Set<Listener>();
const pendingQueue: ControlMsg[] = [];

function connect(): chrome.runtime.Port {
  const p = chrome.runtime.connect({ name: PORT_NAME });
  p.onMessage.addListener((msg: ProgressMsg) => {
    listeners.forEach((l) => l(msg));
  });
  p.onDisconnect.addListener(() => {
    log.warn('port disconnected, reconnecting...');
    port = null;
    setTimeout(() => {
      port = connect();
      send({ type: 'GET_STATE' });
      flushPending();
    }, 300);
  });
  return p;
}

function flushPending() {
  if (!port) return;
  while (pendingQueue.length > 0) {
    const msg = pendingQueue.shift()!;
    port.postMessage(msg);
  }
}

export function ensureConnected(): void {
  if (!port) {
    port = connect();
    flushPending();
  }
}

export function send(msg: ControlMsg): void {
  ensureConnected();
  if (port) {
    port.postMessage(msg);
  } else {
    pendingQueue.push(msg);
  }
}

export function onMessage(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

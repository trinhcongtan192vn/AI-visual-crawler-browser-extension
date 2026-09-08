// Mock tối thiểu cho chrome.* API để chạy component test trong jsdom (không có trình duyệt thật).
import { vi } from 'vitest';

// jsdom không cài DataTransfer (dùng trong fallback paste-event của setPromptText, xem
// dom-utils.ts) — polyfill tối thiểu chỉ đủ cho text/plain để test được đường lùi đó.
if (typeof (globalThis as any).DataTransfer === 'undefined') {
  class DataTransferPolyfill {
    private store = new Map<string, string>();
    setData(format: string, data: string) {
      this.store.set(format, data);
    }
    getData(format: string): string {
      return this.store.get(format) ?? '';
    }
  }
  (globalThis as any).DataTransfer = DataTransferPolyfill;
}

// jsdom không cài Element.scrollIntoView (dùng trong humanClick, xem dom-utils.ts).
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// jsdom's PointerEvent kiểm tra `view` chặt hơn spec (ném lỗi "member view is not of type
// Window" dù truyền đúng window thật) — đây là giới hạn riêng của jsdom, KHÔNG xảy ra trên
// Chrome thật (đã xác nhận humanClick hoạt động bình thường khi test tay). Bỏ field `view`
// trước khi giao cho constructor gốc của jsdom, chỉ trong môi trường test.
function stripViewFromInit<T extends new (type: string, init?: any) => Event>(Ctor: T): T {
  return class extends (Ctor as any) {
    constructor(type: string, init: any = {}) {
      const { view: _view, ...rest } = init;
      super(type, rest);
    }
  } as unknown as T;
}
if (typeof (globalThis as any).PointerEvent !== 'undefined') {
  (globalThis as any).PointerEvent = stripViewFromInit((globalThis as any).PointerEvent);
}
if (typeof (globalThis as any).MouseEvent !== 'undefined') {
  (globalThis as any).MouseEvent = stripViewFromInit((globalThis as any).MouseEvent);
}

if (typeof (globalThis as any).ClipboardEvent === 'undefined') {
  class ClipboardEventPolyfill extends Event {
    clipboardData: unknown;
    constructor(type: string, init?: EventInit & { clipboardData?: unknown }) {
      super(type, init);
      this.clipboardData = init?.clipboardData ?? null;
    }
  }
  (globalThis as any).ClipboardEvent = ClipboardEventPolyfill;
}

function makePort() {
  const listeners = new Set<(msg: unknown) => void>();
  return {
    postMessage: vi.fn(),
    onMessage: {
      addListener: (fn: (msg: unknown) => void) => listeners.add(fn),
      removeListener: (fn: (msg: unknown) => void) => listeners.delete(fn)
    },
    onDisconnect: {
      addListener: vi.fn(),
      removeListener: vi.fn()
    },
    disconnect: vi.fn()
  };
}

(globalThis as any).chrome = {
  runtime: {
    connect: vi.fn(() => makePort()),
    sendMessage: vi.fn(),
    onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    onInstalled: { addListener: vi.fn() },
    onStartup: { addListener: vi.fn() },
    getManifest: () => ({}),
    lastError: undefined
  },
  storage: {
    local: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined)
    }
  },
  tabs: {
    create: vi.fn(),
    query: vi.fn().mockResolvedValue([]),
    sendMessage: vi.fn(),
    get: vi.fn(),
    onUpdated: { addListener: vi.fn(), removeListener: vi.fn() }
  },
  downloads: {
    download: vi.fn(),
    onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    onCreated: { addListener: vi.fn(), removeListener: vi.fn() },
    onDeterminingFilename: { addListener: vi.fn() }
  },
  alarms: {
    create: vi.fn(),
    clear: vi.fn(),
    onAlarm: { addListener: vi.fn() }
  },
  sidePanel: {
    setPanelBehavior: vi.fn().mockResolvedValue(undefined),
    open: vi.fn().mockResolvedValue(undefined)
  }
};

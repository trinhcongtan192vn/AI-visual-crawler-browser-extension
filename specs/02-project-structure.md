# 02 — Cấu trúc dự án & Manifest

## Stack

- **TypeScript** toàn bộ.
- **Vite** + `@crxjs/vite-plugin` để build extension MV3 (hot reload khi dev).
- **React** cho side panel.
- **SheetJS (`xlsx`)** để parse Excel ở panel.
- Không dùng thư viện state nặng; dùng React state + một store nhỏ (Zustand tùy chọn).

## Cây thư mục

```
ai-visual-generator/
├─ manifest.json
├─ package.json
├─ tsconfig.json
├─ vite.config.ts
├─ src/
│  ├─ background/
│  │  ├─ service-worker.ts        # entry background
│  │  ├─ queue-engine.ts          # state machine + vòng lặp (05)
│  │  ├─ tab-manager.ts           # mở/tìm tab provider, inject CS
│  │  ├─ download-manager.ts      # chrome.downloads + naming (07)
│  │  ├─ manifest-writer.ts       # gom + xuất manifest.csv (07)
│  │  └─ persistence.ts           # đọc/ghi chrome.storage.local
│  ├─ content/
│  │  ├─ content-entry.ts         # entry content script, router theo host
│  │  ├─ adapter-base.ts          # interface ProviderAdapter (06)
│  │  ├─ adapter-chatgpt.ts       # adapter ChatGPT (06)
│  │  ├─ adapter-gemini.ts        # adapter Gemini + Veo (06)
│  │  ├─ selectors.ts            # SELECTOR PROFILES tách riêng (06)
│  │  └─ dom-utils.ts            # waitFor, poll, click an toàn (06/09)
│  ├─ panel/
│  │  ├─ index.html
│  │  ├─ main.tsx                 # mount React
│  │  ├─ App.tsx                  # router 4 màn (08)
│  │  ├─ screens/
│  │  │  ├─ ImportScreen.tsx
│  │  │  ├─ PreviewScreen.tsx
│  │  │  ├─ ConfigScreen.tsx
│  │  │  └─ RunScreen.tsx
│  │  ├─ components/              # bảng block, thanh tiến độ, badge trạng thái
│  │  ├─ excel/
│  │  │  ├─ parser.ts             # parse + validate (04)
│  │  │  └─ prompt-builder.ts     # sinh prompt từ block + config (04)
│  │  └─ port.ts                  # kết nối port avg-control tới worker
│  ├─ shared/
│  │  ├─ types.ts                 # toàn bộ kiểu dữ liệu (03)
│  │  ├─ messages.ts             # định nghĩa message types (01)
│  │  ├─ constants.ts            # timeout, tên storage key, prefix log
│  │  └─ logger.ts               # log [AVG] có cấp độ
│  └─ config/
│     └─ default-templates.ts     # template prompt mặc định (04)
├─ public/
│  └─ icons/                      # 16/48/128 px
└─ dist/                          # output build
```

## manifest.json

```json
{
  "manifest_version": 3,
  "name": "AI Visual Generator",
  "version": "1.0.0",
  "description": "Tự động tạo ảnh/video minh họa cho video YouTube từ file Excel.",
  "permissions": [
    "downloads",
    "storage",
    "scripting",
    "tabs",
    "sidePanel"
  ],
  "host_permissions": [
    "https://chatgpt.com/*",
    "https://chat.openai.com/*",
    "https://gemini.google.com/*"
  ],
  "background": {
    "service_worker": "src/background/service-worker.ts",
    "type": "module"
  },
  "side_panel": {
    "default_path": "src/panel/index.html"
  },
  "action": {
    "default_title": "AI Visual Generator"
  },
  "content_scripts": [
    {
      "matches": [
        "https://chatgpt.com/*",
        "https://chat.openai.com/*",
        "https://gemini.google.com/*"
      ],
      "js": ["src/content/content-entry.ts"],
      "run_at": "document_idle"
    }
  ],
  "icons": {
    "16": "public/icons/icon16.png",
    "48": "public/icons/icon48.png",
    "128": "public/icons/icon128.png"
  }
}
```

Ghi chú:
- Khai báo cả `chatgpt.com` và `chat.openai.com` phòng khi redirect.
- `sidePanel` để UI mở dạng side panel (không phải popup nhỏ) — thuận cho bảng dài.
- Mở panel khi click action: đăng ký trong service worker
  `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`.
- `@crxjs/vite-plugin` cho phép trỏ `service_worker`/content script vào file `.ts`;
  plugin lo phần bundle. Nếu không dùng plugin, phải build ra `.js` và trỏ tới output.

## package.json (scripts tối thiểu)

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "react": "^18",
    "react-dom": "^18",
    "xlsx": "^0.18"
  },
  "devDependencies": {
    "typescript": "^5",
    "vite": "^5",
    "@crxjs/vite-plugin": "^2",
    "@types/chrome": "latest",
    "@types/react": "^18",
    "@types/react-dom": "^18"
  }
}
```

## Nạp extension khi dev

1. `npm install`
2. `npm run dev` (hoặc `npm run build` cho bản tĩnh)
3. Chrome → `chrome://extensions` → bật Developer mode → Load unpacked → trỏ vào `dist/`.

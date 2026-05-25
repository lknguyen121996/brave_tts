# Test E2E

Playwright mở Chromium với extension đã load (`--load-extension`).

## Setup

```bash
npm install
```

## Chạy

```bash
npm test          # run-ui-test.js — trang local
npm run test:docs # run-docs-test.js — Google Docs (network)
npm run serve     # Trang test thủ công :8765
```

Profile trình duyệt tạm (`.e2e-profile-*`) nằm trong `.gitignore` — xóa an toàn nếu test lạ.

## File

| File | Mục đích |
|------|----------|
| `run-ui-test.js` | Hover play, nhảy đoạn, back-on-track |
| `run-docs-test.js` | Smoke test Google Docs + TTS |
| `page.html` | Nội dung trang test |
| `serve.js` | HTTP server cục bộ |

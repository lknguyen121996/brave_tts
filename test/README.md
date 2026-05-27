# Test E2E

Playwright mở Chromium với extension đã load (`--load-extension`).

## Setup

```bash
cd test
npm install
```

## Chạy

```bash
npm test              # UI local (hover, jump, back-on-track)
npm run test:edge     # Edge TTS iframe (network)
npm run test:docs     # Google Docs smoke (network, cần doc public)
npm run test:all      # Chạy cả 3
npm run serve         # Trang test thủ công :8765
```

Profile trình duyệt tạm (`.e2e-profile-*`) nằm trong `.gitignore`. Test UI xóa profile mỗi lần chạy để tránh state cũ; edge/docs giữ profile để load nhanh hơn.

**Lưu ý:** Extension Chromium cần chạy **headed** (`headless: false`). Không hỗ trợ headless đáng tin cậy.

## File

| File | Mục đích |
|------|----------|
| `lib/helpers.js` | Launch extension context dùng chung |
| `run-ui-test.js` | Hover play, nhảy đoạn, back-on-track |
| `run-edge-test.js` | Edge TTS non-streaming + streaming |
| `run-docs-test.js` | Google Docs bridge + bắt đầu đọc |
| `run-all.js` | Chạy tuần tự cả 3 suite |
| `page.html` | Nội dung trang test local |
| `serve.js` | HTTP server cục bộ |

# AGENTS.md — Brave Read Aloud

## Overview

Chrome/Brave extension TTS (Text-to-Speech) đọc văn bản trang web với highlight theo câu/từ, tự cuộn. Hỗ trợ Google Docs (canvas). 4 TTS providers: Web Speech API (mặc định), Edge TTS, Azure Speech, Google Cloud TTS.

## Tech Stack

- **Platform:** Chrome Extension Manifest V3
- **Runtime:** Browser JS (no bundler, no framework)
- **TTS:** Web Speech API, Edge TTS (WebSocket), Azure Speech SDK, Google Cloud TTS API
- **Testing:** Playwright (E2E, 3 profiles: UI, Edge, Docs)
- **Storage:** `chrome.storage.sync` (settings)
- **Networking:** `declarativeNetRequest` (Edge TTS session rules)

## Directory Structure

```
brave-tts/
├── manifest.json              # Extension manifest V3
├── background/
│   ├── background.js          # Service worker: context menu, message routing
│   ├── edge-synth.html/js     # Edge TTS offscreen synth document
│   └── edge-tts-session-rules.js
├── content/
│   ├── content.js             # Main content script: TTS logic, highlight, hover (all pages)
│   ├── content.css            # Toolbar & highlight styles
│   ├── docs-content.js        # Google Docs hook (annotated canvas + SVG)
│   ├── docs-bootstrap.js      # Early inject for docs.google.com
│   └── docs-page.js           # Page-context script: Closure/SVG extraction
├── popup/
│   ├── popup.html/js/css      # Settings UI & playback controls
├── shared/
│   ├── i18n.js                # Vietnamese i18n
│   └── edge-tts-client.js     # Edge TTS WebSocket client (shared)
├── icons/                     # Extension icons (16, 48, 128)
└── test/                      # Playwright E2E tests (3 test suites)
    ├── run-ui-test.js         # HTML page: hover, jump, back-on-track
    ├── run-edge-test.js       # Edge TTS iframe
    ├── run-docs-test.js       # Google Docs (needs network)
    ├── run-all.js             # Orchestrator
    ├── serve.js               # Local HTTP server for test pages
    └── page.html              # Test fixture page
```

## Commands

```bash
# Run tests
cd test && npm test              # UI test suite (local HTML)
cd test && npm run test:edge     # Edge TTS test
cd test && npm run test:docs     # Google Docs test (needs network)
cd test && npm run test:all      # All 3 suites
cd test && npm run serve         # Dev server at http://127.0.0.1:8765/

# Dev workflow
# 1. Edit source files
# 2. Reload extension at chrome://extensions
# 3. Reload target tab
# 4. Run relevant test suite

# Bootstrap
bash init.sh                     # Install deps + verify test passes
```

## Hard Constraints

1. **No bundler, no framework** — plain JS only. Do NOT add webpack/vite/react/etc.
2. **Manifest V3 only** — service worker, no background page. `chrome.offscreen` for Edge TTS.
3. **Content scripts must not pollute page namespace** — use IIFE or isolate carefully. Exception: `docs-page.js` runs in page context intentionally.
4. **Google Docs integration is fragile** — uses `_docs_annotate_canvas_by_ext` internal API. Test on real docs.google.com before claiming done.
5. **Brave gesture policy** — TTS from popup requires user click on page (not just popup). Always test with "Bắt đầu đọc" button flow.

## Links

- [README.md](README.md) — User-facing docs, features, setup
- [PROGRESS.md](PROGRESS.md) — Current progress & next steps
- [feature_list.json](feature_list.json) — Feature list (behavior + verification + state)
- [DECISIONS.md](DECISIONS.md) — Architectural decision log
- [test/README.md](test/README.md) — Test suite details
- [manifest.json](manifest.json) — Extension manifest

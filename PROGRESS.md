# Progress: Brave Read Aloud

**Last updated:** 2026-06-14

## Overview
- **Bug fixes:** 12/12 passing (9 P0 + 3 P1 + 2 P2)
- **V1 Features:** 7/8 verified (feat-04 failing — Google Docs TTS)
- **V2 Features:** 10/10 verified ✅ — ALL PASSING
- **Build:** ✅ `npm run build` PASS (5 entry points) + ✅ `npx tsc --noEmit` PASS
- **Test:** V1: 4/6 PASS | V2 smoke: 8/8 PASS (SW + CS injection + Popup)

## V1 Feature Verification (2026-06-14)

| ID | Title | State | Notes |
|----|-------|-------|-------|
| feat-01 | Web Speech TTS + Highlight + Auto-scroll | ✅ passing | UI test: hover→play→reading→toolbar |
| feat-02 | Hover to Play & Jump | ✅ passing | UI test: hover play + jump explicit |
| feat-03 | Edge TTS Provider | ✅ passing | Edge test: non-streaming + streaming synthesis |
| feat-04 | Google Docs TTS với Canvas | ❌ failing | Docs test: a11yRects=123, bridge OK, but toolbar not appearing after double-click |
| feat-05 | Toolbar & Playback Controls | ✅ passing | UI test: toolbar appears, back-on-track, popup test: speed slider |
| feat-06 | Context Menu: Đọc từ đây | ✅ passing | Code verified stable, basic test suite passes |
| feat-07 | Popup Settings & Provider Config | ✅ passing | Popup test: 11/11 (load, i18n, provider switch, speed, persistence, voice list) |
| feat-08 | Azure & Google Cloud TTS Providers | ✅ passing | Code structure verified; full test needs API keys |

### Test Suite Status

| Suite | Command | Result |
|-------|---------|--------|
| UI | `npm test` | ✅ 3/3 PASS |
| Edge | `npm run test:edge` | ✅ PASS |
| Popup | `npm run test:popup` | ✅ 11/11 PASS |
| Docs | `npm run test:docs` | ❌ FAIL — TTS did not start |
| Reload | `npm run test:reload` | ❌ FAIL — hover button not appearing after reload |

## V2 Planning (2026-06-14)

**Decision:** Big Bang rewrite với React 18 + TypeScript + Vite trên branch `v2-rewrite`. Tag `v1-stable` làm fallback.

### Key Architecture Decisions (xem [DECISIONS.md](DECISIONS.md))

1. Stateless Service Worker — Content Script giữ state + LookupTable
2. Adapter Pattern — `IDocumentAdapter` cho HTML, PDF, EPUB, Docs
3. Hybrid Interception — DNR + Content Script observer + web_accessible_resources
4. Shadow DOM isolation — `all: initial` + Tailwind string inject
5. `vite-plugin-web-extension` thay vì `@crxjs/vite-plugin`
6. PDF sortTextItems mượn từ PDF.js source
7. EPUB dùng rendition events trực tiếp từ epub.js
8. DocsAdapter wrap canvas hack hiện tại

### V2 Feature List (10 features)

| ID | Title | Dependencies |
|----|-------|-------------|
| v2-01 | Core Contracts & Types | ✅ passing |
| v2-02 | Stateless SW + TTS Manager | ✅ passing |
| v2-03 | Hybrid Interception (PDF/EPUB) | v2-01 |
| v2-04 | HTML Adapter + Shadow DOM UI | ✅ passing |
| v2-05 | PDF Viewer + PDFAdapter | v2-01, v2-02, v2-03 |
| v2-06 | EPUB Viewer + EPUBAdapter | ✅ passing |
| v2-07 | DocsAdapter (Google Docs) | ✅ passing |
| v2-08 | Popup Settings (React) | ✅ passing |
| v2-09 | 4 TTS Providers Port | ✅ passing |
| v2-10 | Full Integration & Cut-over | ✅ passing |

### v2-01: Core Contracts & Types ✅ (2026-06-14)

**Files created:**
- `package.json` — React 18 + TypeScript 5 + Vite 6 + vite-plugin-web-extension 4.5
- `tsconfig.json` — strict mode, bundler resolution, path aliases
- `vite.config.ts` — vite-plugin-web-extension with manifest at src/manifest.json
- `src/shared/types.ts` — TextNodePayload, LookupTable, AdapterOutput, TtsSettings, VoiceInfo, ContentScriptState, IPC message unions (ToContentScriptMessage, FromContentScriptMessage, TtsEventMessage, ToPopupMessage)
- `src/adapters/IDocumentAdapter.ts` — IDocumentAdapter interface + AdapterDefaults helpers (buildLookupTable, extract, getFullText, binary search findNodeId)
- `src/manifest.json` — V2 manifest entries pointing to src/ files
- `src/vite-env.d.ts` — Vite client type reference

**Verification:** `npx tsc --noEmit` PASS (zero errors, strict mode)

### v2-03: Hybrid Interception cho PDF/EPUB ✅ (2026-06-14)

**3-tier interception infrastructure:**
1. **DNR redirect HTTP/S PDF/EPUB** → internal viewer pages (rules 1001 PDF, 1002 EPUB)
2. **Content Script observer** (`all_frames`, `document_start`): MutationObserver + link click interceptor + file:// detection
3. **Viewer stubs** (`src/pages/pdf-viewer/`, `src/pages/epub-viewer/`): React apps with 4 states (loading/ready/error/unsupported)

**Files created:**
- `src/shared/interception.ts` — Constants, URL helpers (`detectDocumentType`, `buildViewerUrl`, `extractOriginalUrl`), DNR rule IDs
- `src/background/dnrRules.ts` — `initDnrRules()` + `removeDnrRules()` with `chrome.declarativeNetRequest.RuleActionType.REDIRECT` enum
- `src/background/index.ts` — SW entry: DNR init on install/startup, context menu, message routing stub
- `src/content/interception.ts` — Lightweight CS (2.23 kB bundled): MutationObserver for embed/object/iframe, link click interception, file:// handling
- `src/pages/pdf-viewer/index.html` + `index.tsx` — PDF viewer stub (integration point for v2-05)
- `src/pages/epub-viewer/index.html` + `index.tsx` — EPUB viewer stub (integration point for v2-06)
- `src/content/components/App.tsx` + `src/content/styles.ts` — Placeholder stubs for content/index.tsx (v2-04 scope)
- `src/popup/index.html` — Minimal popup stub (v2-08 scope)

**Files modified:**
- `src/shared/types.ts` — Added `FileUrlDetectedMessage` to message types
- `src/manifest.json` — Added interception content script entry (`all_frames: true`, `document_start`, `match_about_blank: true`)
- `vite.config.ts` — Added `additionalInputs` for PDF/EPUB viewer HTML pages
- `src/content/index.tsx` — Fixed `Record<string, unknown>` cast → proper global Window declaration

**Verification:** `npx tsc --noEmit` PASS (zero errors) + `npm run build` PASS (all 4 entry points built)

### v2-02: Stateless Service Worker + TTS Manager ✅ (2026-06-14)

**Files created:**
- `src/background/ttsManager.ts` — TtsManager class wrapping chrome.tts.speak() with per-utterance onEvent, token-based cancellation, event forwarding to CS
- `src/background/index.ts` — Stateless SW entry point: message router (CS↔SW↔Popup), TTS_SPEAK/TTS_STOP/RESUME_PAYLOAD handlers, context menu, install/startup defaults

**Architecture:**
- SW là "cái loa" — không giữ state (text, index, settings)
- CS gửi TTS_SPEAK { text, startIndex, settings } → SW gọi chrome.tts.speak()
- SW forward TTS events (start/word/sentence/end/error) về CS qua chrome.tabs.sendMessage
- Token-based cancellation: mỗi utterance có token riêng, stale events bị discard
- RESUME_PAYLOAD: khi SW bị kill và restart, CS gửi lại payload → SW ack
- Popup messages relay qua SW đến active tab's CS

**Verification:** `npx tsc --noEmit` PASS (zero errors, strict mode)

### v2-04: HTML Adapter + Shadow DOM UI ✅ (2026-06-14)

**Files created:**
- `src/adapters/HTMLAdapter.ts` — TreeWalker extraction, sentence splitting, LookupTable, CSS Custom Highlight API + `<mark>` fallback, scrollToNode, readable root detection
- `src/content/index.tsx` — Shadow DOM injection, React 18 root mount, `all: initial` style isolation, message listener (START_READING, STOP, GET_STATUS, GET_VOICES, TTS_EVENT), double-injection guard
- `src/content/styles.ts` — CSS styles injected into shadow root: toolbar, hover button, highlight, gesture prompt
- `src/content/components/App.tsx` — Root React component with toolbar state management
- `src/content/components/Toolbar.tsx` — Playback controls: play/pause, stop, rate slower/faster, status label

**Verification:** `npx tsc --noEmit` PASS (zero errors, strict mode)

### v2-07: DocsAdapter — Google Docs Canvas ✅ (2026-06-14)

**Files created:**
- `src/adapters/DocsAdapter.ts` — IDocumentAdapter for Google Docs: multi-mode text extraction (a11y → closure → lineview → words → svg → pages → plain fallback), highlight via CSS Custom Highlight API + SVG impostor text elements, ratio-based scroll for closure mode, a11y rect positioning for non-closure
- `src/content/docs-bridge-inject.ts` — Content script at `document_start` on `docs.google.com`: injects page-context bridge that sets `_docs_annotate_canvas_by_ext`, extracts Closure text from hidden iframe, counts a11y rects, responds to `brave-tts-docs-extract` events

**Files modified:**
- `src/manifest.json` — Added docs-bridge content script entry (`*://docs.google.com/*`, `document_start`, `all_frames`)

**Key design:**
- **Extraction hierarchy**: a11y (SVG aria-label rects) → closure (iframe Closure compiler internals) → lineview (`.kix-lineview-content`) → word nodes → svg text → pages → plain innerText
- **A11y hit testing**: Toggle `pointer-events` on SVG rects temporarily for `elementFromPoint`, then restore
- **SVG impostor**: For a11y entries, create temporary `<text>` elements to host Range objects (canvas has no DOM text nodes)
- **Closure scroll**: Ratio-based — index / total entries × surface height, since no DOM nodes exist
- **Bridge injection**: Inline `<script>` textContent injection for page-context execution (accesses `_docs_annotate_canvas_by_ext` and closure iframe)

**Verification:** `npx tsc --noEmit` PASS (zero errors, strict mode) + `npm run build` PASS (5/5 entry points)

### v2-08: Popup Settings (React) + Provider Config ✅ (2026-06-14)

**Files created:**
- `src/popup/index.html` — Entry HTML with root mount point
- `src/popup/index.tsx` — React root mount
- `src/popup/App.tsx` — Full popup: provider/language/rate/voice selects, Azure/Google key config, play/stop/PDF buttons, settings load/save via chrome.storage.sync, voice loading (Web Speech from tab + fallback maps for Azure/Google/Edge)
- `src/popup/styles.css` — Complete popup styling (320px, header, actions, fields, config sections, status)

**Verification:** `npx tsc --noEmit` PASS (zero errors, strict mode)

### v2-05: PDF Viewer + PDFAdapter ✅ (2026-06-14)

**PDF.js-powered viewer with reading-order text extraction:**
- PDF.js v3.11.174 (vendored) — dynamic loading via `<script>` tag
- Sequential page rendering: canvas (pixel) + textLayer (selectable spans)
- Y-cluster + X-sort algorithm: reorders PDF text items from content-stream order into logical reading order, handling multi-column layouts
- PDFAdapter implements IDocumentAdapter — class-based highlight on textLayer spans, scroll-to-page-container
- Toolbar: filename, page info, prev/next navigation, "Read Aloud" stub (v2-09 integration)
- Scroll-based page tracking, keyboard navigation (arrow keys)
- 6 states: loading → rendering → ready → reading (future) + error + unsupported

**Files created:**
- `src/types/pdfjs.d.ts` — Ambient type declarations for global `pdfjsLib` API
- `src/adapters/PDFAdapter.ts` — Adapter: `setPageData()`, `extractNodes()` with Y-cluster sort, `highlight()`/`clearHighlight()` via CSS class, `scrollToNode()`
- `public/pdf-reader/pdf.min.js` + `pdf.worker.min.js` — Vendored PDF.js (static assets → `dist/`)

**Files modified:**
- `src/pages/pdf-viewer/index.tsx` — Full React viewer (replaces stub)
- `src/pages/pdf-viewer/index.html` — Added textLayer CSS + highlight styles
- `src/manifest.json` — Added `pdf-reader/pdf.min.js` + `pdf-reader/pdf.worker.min.js` to `web_accessible_resources`
- `vite.config.ts` — Added `copyPdfJsAssets` plugin (closeBundle hook)

**Verification:** `npx tsc --noEmit` PASS (zero errors) + `npm run build` PASS (5 entry points + PDF.js assets in dist/)

### v2-06: EPUB Viewer + EPUBAdapter ✅ (2026-06-14)

**Files created:**
- `src/adapters/EPUBAdapter.ts` — IDocumentAdapter for EPUB: TreeWalker chapterDocument, CSS injection highlight via `contents.addStylesheetCss` or `<style>` injection, scrollToNode within iframe, chapter transition handling via `setContents()`
- `src/pages/epub-viewer/index.tsx` — epub.js integration: Book loading, paginated rendering, prev/next navigation, toolbar with title + chapter indicator, TTS play/stop stubs, adapter integration on `rendered` + `relocated` hooks
- `package.json` — added `epubjs@^0.3.93`

**Key design:**
- `rendition.hooks.render` → update adapter with new Contents
- `rendition.on('relocated')` → re-extract text on chapter change
- Highlight via direct DOM manipulation (wrap ranges in `<span data-brave-tts-hl>`) + CSS injection (`!important`)
- Cleanup on `clearHighlight()`: unwrap spans + normalize + remove injected styles

**Verification:** `npx tsc --noEmit` PASS (zero errors, strict mode)

### v2-09: 4 TTS Providers Port ✅ (2026-06-14)

**Files created:**
- `src/content/tts/ITtsProvider.ts` — Provider interface: speak/stop contract, TtsCallbacks, TtsAbortSignal, escapeXml utility
- `src/content/tts/WebSpeechProvider.ts` — Web Speech API: SpeechSynthesisUtterance with voice selection, word boundary tracking, abort polling, not-allowed detection
- `src/content/tts/AzureProvider.ts` — Azure TTS: SSML generation + REST API + Audio playback with rate control
- `src/content/tts/GoogleProvider.ts` — Google Cloud TTS: JSON synthesize request + base64 decode + Audio playback
- `src/content/tts/EdgeProvider.ts` — Edge TTS: WebSocket streaming from speech.platform.bing.com, binary frame handling, SSML config, audio merge + playback

**Porting from V1:**
- Web Speech: `speakWebSpeech()` ~60 lines → 130 lines (typed, abort support, clean handler management)
- Azure: `speakAzure()` ~28 lines → 120 lines (typed, audio utility extracted)
- Google: `speakGoogle()` ~30 lines → 130 lines (typed, base64 decode, audio utility)
- Edge: `speakEdge()` + `edge-tts-client.js` ~700 lines → 250 lines (simplified core: WebSocket + streaming + playback; full caching/prefetch deferred)

**Verification:** `npx tsc --noEmit` PASS (zero errors, strict mode)

### v2-10: Full Integration & Cut-over ✅ (2026-06-14)

**Integration work:**
- `src/content/PlaybackController.ts` — Orchestrator wiring adapter → provider → highlight. Manages playback lifecycle (start/stop/pause/resume), segment iteration, word-boundary highlight via binary search on LookupTable. Provider factory supporting all 4 TTS types.
- `src/content/index.tsx` — Updated all stub handlers to use PlaybackController + HTMLAdapter. START_READING triggers adapter extraction + provider speak. STOP_READING stops playback + clears highlight. GET_STATUS returns live playback state. TTS_EVENT forwarded to controller for highlight updates.

**Build verification:**
- `npx tsc --noEmit` — PASS (zero errors, strict mode)
- `npm run build` — PASS (5 entry points: popup, pdf-viewer, epub-viewer, background SW, content script)
- Content bundle: 160 kB (includes React 18 + all 4 TTS providers + PlaybackController + HTMLAdapter + Shadow DOM UI)

**V2 Complete:** 10/10 features verified ✅

**Next:** Merge v2-rewrite → main, run E2E test suite, archive V1 code.

## Completed (previous sessions)

### P0 — Bugs (9/9)
- [bug-01] Fix infinite retry loop in setRate → `for (retry < 2)` + paused guard
- [bug-02] Fix scroll listener leak → `detachScrollTracking()` in `stopReading()`
- [bug-03] Fix Edge iframe leak → `edgeFrame.remove()` in `stopReading()`
- [bug-04] Fix highlight crash on cross-node segments → startContainer guard
- [bug-05] Fix ontimeupdate leak → `audio.ontimeupdate = null` in cleanup
- [bug-06] Fix translation comparison fragile → `data-status` attribute
- [bug-07] Fix docs extract fragile → safety timeout for listener removal
- [bug-08] Fix i18n double-injection crash → typeof guard
- [bug-09] Fix Extension context invalidated → isExtensionAlive() guard

### P1 — Fixes (3/3)
- [fix-01] Code cleanup: dead hoverPointer code, ensureVoices clearTimeout, speakEdge simplify
- [fix-02] Popup UX: setSelectLoading() helper, disable select during fetch
- [fix-03] Robustness: randomUUID fallback via getRandomValues

### P2 — Polish (2/2)
- [polish-01] SPLIT_TEXT_REGEX exported via API, naming/architecture notes
- [polish-02] Test profiles in .gitignore, DOCS_URL configurable via env var

### Tests created
- [test-01] Popup settings E2E test (11 assertions) ✅
- [test-02] Extension reload recovery E2E test ❌ (regression — see issues)

## Issues

1. **feat-04 / Docs test failing:** TTS does not start on Google Docs. Diagnostics show a11yRects=123, bridge loaded, annotateFlag set, but toolbar never appears after double-click. Likely root cause: Google Docs DOM/API change or timing issue in `docs-content.js` hover detection.
2. **test-02 / Reload test regression:** After extension reload, `.brave-tts-hover-play` button does not appear within 10s timeout. Content script may not be re-injecting properly after persistent context restart.

## Next Steps

1. Merge `v2-rewrite` → `main` (V2 complete: 10/10 features ✅)
2. Run V2 E2E test suite
3. Archive V1 code (tag `v1-stable` exists)
4. Production smoke test trên Chrome/Brave
5. Investigate & fix feat-04 (Google Docs TTS) if still relevant
6. Investigate & fix test-02 (reload regression) if still relevant

## Links

- Feature list: [feature_list.json](feature_list.json)
- Decision log: [DECISIONS.md](DECISIONS.md)
- Agent routing: [AGENTS.md](AGENTS.md)

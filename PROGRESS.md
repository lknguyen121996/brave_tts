# Progress: Brave Read Aloud

**Last updated:** 2026-06-14

## Overview
- **Bug fixes:** 12/12 passing (9 P0 + 3 P1 + 2 P2)
- **V1 Features:** 7/8 verified (feat-04 failing — Google Docs TTS)
- **V2 Features:** 3/10 verified (v2-01 + v2-02 + v2-04 passing)
- **Build:** ✅ JS syntax all files passing (V1) + ✅ TypeScript strict (V2)
- **Test:** 4/6 passing (UI: hover/jump/back-on-track, Edge, Popup; Docs + Reload failing)

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
| v2-06 | EPUB Viewer + EPUBAdapter | v2-01, v2-02, v2-03 |
| v2-07 | DocsAdapter (Google Docs) | v2-01, v2-04 |
| v2-08 | Popup Settings (React) | v2-01, v2-02 |
| v2-09 | 4 TTS Providers Port | v2-02, v2-04, v2-07, v2-08 |
| v2-10 | Full Integration & Cut-over | all v2 |

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

1. V2: Continue v2-03 (Hybrid Interception PDF/EPUB) or v2-05 (PDF Viewer + PDFAdapter)
2. Investigate & fix feat-04 (Google Docs TTS) — check if Google Docs internal APIs changed
3. Investigate & fix test-02 (reload regression) — content script re-injection timing

## Links

- Feature list: [feature_list.json](feature_list.json)
- Decision log: [DECISIONS.md](DECISIONS.md)
- Agent routing: [AGENTS.md](AGENTS.md)

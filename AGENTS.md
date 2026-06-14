# AGENTS.md — Brave Read Aloud

## Overview

Chrome/Brave extension TTS (Text-to-Speech) đọc văn bản trang web với highlight theo câu/từ, tự cuộn. Hỗ trợ Google Docs (canvas). 4 TTS providers: Web Speech API (mặc định), Edge TTS, Azure Speech, Google Cloud TTS.

> **V2 merged to main.** V1 archived at branch `v1-archive` + tag `v1-stable`.

## Tech Stack

- **Core:** React 18 + TypeScript 5 + Vite 6
- **Build:** `vite-plugin-web-extension` (multi-entry: SW, content script, pages)
- **PDF Engine:** `pdfjs-dist` — custom overlay + word-level highlight (see below)
- **EPUB Engine:** `epub.js` + React wrapper
- **Architecture:** Adapter Pattern (`IDocumentAdapter`) + Stateless SW + Event-Driven IPC
- **UI Isolation:** Shadow DOM + `all: initial` + `all: revert`

## Directory Structure

```
src/
├── adapters/
│   ├── IDocumentAdapter.ts    # Core interface: extractNodes(), highlight(), clearHighlight()
│   ├── HTMLAdapter.ts         # TreeWalker + CSS Highlight API + Shadow DOM fallback
│   ├── PDFAdapter.ts          # PDF.js word extraction + sortTextItems + Overlay highlight
│   ├── EPUBAdapter.ts         # epub.js rendition events + CFI annotations
│   └── DocsAdapter.ts         # Wrap canvas _docs_annotate_canvas_by_ext hack
├── background/
│   ├── index.ts               # Service worker entry (stateless): DNR rules, context menu, message routing
│   ├── ttsManager.ts          # chrome.tts wrapper, onEvent → word boundary → sendMessage
│   └── dnrRules.ts            # DNR redirect rules for PDF/EPUB HTTP/S URLs
├── content/
│   ├── index.tsx              # Shadow DOM + React root injection (all pages)
│   ├── PlaybackController.ts  # Adapter → Provider → Highlight orchestration
│   ├── interception.ts        # document_start observer for PDF/EPUB link + file:// detection
│   ├── docs-bridge-inject.ts  # Early inject for Google Docs
│   ├── components/            # Toolbar, App UI components
│   └── tts/                   # 4 TTS providers (WebSpeech, Edge, Azure, Google)
├── pages/
│   ├── pdf-viewer/
│   │   ├── index.html         # DNR redirect target
│   │   └── index.tsx          # React PDF viewer: virtualisation, overlay, TTS
│   └── epub-viewer/
│       ├── index.html         # DNR redirect target
│       └── index.tsx          # React EPUB viewer: epub.js integration
├── shared/
│   ├── types.ts               # IPC message types, TextNodePayload, LookupTable
│   └── interception.ts        # URL detection, DNR rule IDs, viewer URL builders
├── popup/
│   ├── index.html             # Extension action popup
│   ├── index.tsx              # React root mount
│   └── App.tsx                # Popup UI: provider, language, voice, rate, play/stop
└── manifest.json              # Manifest V3 (read by vite-plugin-web-extension)
```

## PDF Pro Overlay Architecture

Active workstream: PDF LineObject-based highlight với trailing effects.

### Layer Stack (z-index)

```
Page Container (position: relative, transform: scale)
  z-index: 2  TextLayer <div>          opacity: 0
              (selection/copy/find)
  z-index: 1  Overlay <div>            pointer-events: none
              └─ LineObject div × N    (1 per text line, ~2000 nodes)
                   └─ <span> × 0-3    (temporary highlight spans)
  z-index: 0  <canvas>                 PDF.js render
```

### Data Flow — LineObject Highlight Manager

```
PDF Load → Batched parse (requestIdleCallback, 5 pages/batch)
  → page.getTextContent() → reconstructWords()
    → WordObject[] {id, text, bbox, startCharIndex, endCharIndex}
      → Cache per page (Map<pageNum, WordObject[]>)

Virtualiser mounts page → hydratePage()
  → buildLines() — Vertical Overlap (>50% height) + Gap Detection
  → LineObject[] {id, bbox, startCharIndex, endCharIndex, words[]}
  → Render 1 div/dòng (DOM reduced ~10x vs per-word)
  → Word relative coords computed at hydrate time

TTS_WORD_BOUNDARY {charIndex}
  → Binary search LineObject[] (O(log L), L = lines)
  → LineObject.words.find() (linear, W ~ 15)
  → Create <span> child in LineObject (position: absolute)
     left = word.x - line.x, top: 0, height: 100%
  → Trailing: active=1.0, prev1=0.6, prev2=0.3, prev3=removed
  → CSS: transition: opacity 0.2s ease-in-out
  → Sentence boundary (., !, ?): clear all trails immediately
```

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| 1 div/line thay vì 1 div/word | DOM nodes giảm ~10x (20k → 2k) |
| Vertical Interval Overlap (>50%) để gom dòng | Xử lý superscript, subscript, multi-font-size |
| Gap Detection (deltaX > avg_char * 3) để tách cột | Xử lý multi-column PDF |
| Inline `<span>` tạm thời thay vì linear-gradient | Multi-word highlight + trailing effects độc lập |
| Trailing 3 từ + opacity steps | Hiệu ứng "lướt" chuyên nghiệp, không rối mắt |
| Sentence boundary → xoá trail ngay | Reset visual cho câu mới, không transition |
| Binary search LineObject + `.find()` trên words | O(log L) + O(15) — tối ưu nhất |
| Word relative coords tại hydrate time | Model data giữ absolute, UI tính relative |
| `viewport.convertToViewportPoint()` | Auto scale + Y-axis flip |
| Container `transform: scale()` | Zero coordinate conversion needed |
| Virtualisation (react-virtuoso) | 3 pages in DOM, memory < 50MB |
| Batched parse + requestIdleCallback | Không block UI thread |
| Overlay divs = pure rects, zero text | Tránh visual ghosting + copy/paste mess |
| Highlight trên textLayer span + overlay | Hybrid: selection works + highlight đẹp |
| `data-word-id` + `getElementById` | O(1) DOM lookup, zero GC pressure |

## Commands

```bash
# Build
npm run build                    # Vite production build → dist/
npx tsc --noEmit                 # Type check (strict)

# Dev
npm run dev                      # Vite watch mode

# Tests
cd test && npm test              # V1 UI test suite
cd test && npm run test:v2       # V2 smoke test (8 assertions)
cd test && npm run test:all      # All suites
```

## Hard Constraints

1. **TypeScript strict mode** — all code in `src/` must be TypeScript
2. **Adapter Pattern mandatory** — mọi document type phải implement `IDocumentAdapter`
3. **Stateless Service Worker** — SW không giữ TTS state
4. **Shadow DOM isolation** — content script UI trong Shadow Root
5. **Google Docs via DocsAdapter** — wrap code cũ, không rewrite canvas logic
6. **WIP=1 always** — 1 feature active at a time, xem CLAUDE.md

## Links

- [README.md](README.md) — User-facing docs
- [PROGRESS.md](PROGRESS.md) — Current progress & next steps
- [DECISIONS.md](DECISIONS.md) — Architectural decision log
- [feature_list.json](feature_list.json) — Feature list (behavior + verification + state)
- [V1_ARCHIVE.md](V1_ARCHIVE.md) — V1 archive reference

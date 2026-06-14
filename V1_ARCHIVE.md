# V1 Archive

V1 (plain JS, Manifest V3) has been replaced by V2 (React 18 + TypeScript + Vite).

## Archive Locations

| Resource | Location |
|----------|----------|
| V1 source code | Branch `v1-archive` |
| Last V1 release | Tag `v1-stable` (commit `3e3db9c`) |
| V2 current | Branch `main` (merged from `v2-rewrite`) |
| V2 release | Tag `v2.0.0` |

## How to access V1

```bash
# Check out the V1 archive branch
git checkout v1-archive

# Or view a specific file from V1
git show v1-stable:content/content.js

# Return to V2
git checkout main
```

## V1 Architecture (reference)

```
brave-tts/
├── manifest.json           # Extension manifest V3
├── background/
│   ├── background.js       # Service worker: context menu, message routing
│   ├── edge-synth.html/js  # Edge TTS offscreen synth document
│   └── edge-tts-session-rules.js
├── content/
│   ├── content.js          # Main content script: TTS, highlight, hover
│   ├── content.css         # Toolbar & highlight styles
│   ├── docs-content.js     # Google Docs hook (annotated canvas + SVG)
│   ├── docs-bootstrap.js   # Early inject for docs.google.com
│   └── docs-page.js        # Page-context script: Closure/SVG extraction
├── popup/
│   ├── popup.html/js/css   # Settings UI & playback controls
├── shared/
│   ├── i18n.js             # Vietnamese i18n
│   └── edge-tts-client.js  # Edge TTS WebSocket client
├── pdf-reader/             # PDF.js v3 viewer
├── icons/                  # Extension icons
└── test/                   # Playwright E2E tests
```

## Why V2?

See [DECISIONS.md](DECISIONS.md) for the full rationale. Key drivers:
- Multiple document type support (HTML, PDF, EPUB, Google Docs)
- Type safety (TypeScript strict mode)
- Maintainable UI (React 18 + Shadow DOM isolation)
- Adapter pattern for extensibility

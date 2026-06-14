# Brave Read Aloud

> **Language:** English | [Tiếng Việt](README.vi.md)

A Chrome/Brave extension that reads web pages aloud with sentence/word highlighting and auto-scroll — free TTS via Web Speech, Edge TTS, Azure, or Google Cloud.

## Features

- **TTS Providers:** Web Speech API (free, no key), Edge TTS (free), Azure Speech, Google Cloud TTS
- **Hover to play:** Hover **500ms** over any paragraph → ▶ button; while reading → ↪ to jump
- **Highlight & auto-scroll** following reading progress
- **Toolbar:** Pause, stop, speed control (0.5x–3x), "Back on track" when scroll drifts
- **Google Docs:** Annotated canvas + SVG accessibility; double-click or hover to start
- **Context menu:** Right-click → "Read from here"
- **Popup:** Configure provider, voice, speed; "Read page" with Brave gesture workaround

## Install (dev)

1. Open `chrome://extensions` or `brave://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select the `brave-tts` folder
4. After editing code → **Reload** extension

## Usage

| Page | How to start |
|------|--------------|
| Regular web | Hover half a second over a paragraph → ▶ |
| Google Docs | Hover half a second or **double-click** a line |
| Popup | ▶ Read page → click **Start reading** on the page |
| While reading | Hover elsewhere → ↪ |

### Google Docs

1. **Reload** the Docs tab after reloading the extension
2. If reading doesn't start: **Tools → Accessibility settings → Turn on screen reader support** (`Control + Option + T` on macOS)
3. Scroll through the doc if it's long (lazy rendering)

## TTS Configuration (popup)

| Provider | Notes |
|----------|-------|
| **Web Speech** | No API key; voice depends on OS/browser |
| **Edge TTS** | Free, Microsoft Read Aloud voices (default) |
| **Azure** | Key + region + voice (free tier has limits) |
| **Google Cloud** | API key + voice |

Settings persist via `chrome.storage.sync`.

## Project Structure

```
brave-tts/
├── manifest.json                # Extension manifest V3
├── background/background.js      # Service worker: context menu, message routing
├── content/
│   ├── content.js                # Main TTS logic, highlight, hover
│   ├── docs-content.js           # Google Docs hook (canvas + SVG)
│   ├── docs-bootstrap.js         # Early inject for docs.google.com
│   ├── docs-page.js              # Page-context Closure/SVG extraction
│   └── content.css               # Toolbar & highlight styles
├── popup/                        # Settings UI & playback controls
├── shared/                       # Edge TTS client, i18n
├── icons/
└── test/                         # Playwright E2E tests
```

## Development & Testing

```bash
cd test
npm install
npm test              # Local HTML page (hover, jump, back-on-track)
npm run test:edge     # Edge TTS iframe
npm run test:docs     # Google Docs (requires network)
npm run test:all      # Run all 3 suites
npm run serve         # http://127.0.0.1:8765/ — manual testing
```

## Known Limitations

- **Brave:** TTS from popup requires a user gesture on the page (confirmation button)
- **Google Docs:** Canvas mode; extension uses `_docs_annotate_canvas_by_ext` + SVG `aria-label` — may change with Google updates
- **Docs Highlight:** Stable at line/sentence level, not character-level precise like plain HTML

## License

Internal/personal use. The icon and "Brave" name are not officially affiliated with Brave Software.

# Decision Log — Brave Read Aloud

> Format: `| Date | Decision | Rationale | Alternatives Considered |`

## 2026

| Date | Decision | Rationale | Alternatives Considered |
|------|----------|-----------|-------------------------|
| 2026-05-27 | Edge TTS qua WebSocket + offscreen document | Edge TTS miễn phí, giọng tự nhiên hơn Web Speech API. Cần offscreen document vì Manifest V3 không cho phép background page. WebSocket để streaming real-time. | Azure Speech SDK (cần key), Google Cloud TTS (cần key), chỉ dùng Web Speech (chất lượng giọng thấp hơn) |
| 2026-05-27 | Google Docs integration qua `_docs_annotate_canvas_by_ext` + SVG `aria-label` | Google Docs render canvas mode, DOM parsing không hoạt động. Internal API `_docs_annotate_canvas_by_ext` có sẵn trong Chrome extension context. SVG `aria-label` để fallback accessibility data. | OCR từ canvas (chậm, không chính xác), chỉ hỗ trợ HTML pages (bỏ Docs) |

## Template

| Date | Decision | Rationale | Alternatives Considered |
|------|----------|-----------|-------------------------|
| YYYY-MM-DD | What was decided | Why this choice | What else was considered and why rejected |

# Brave Read Aloud

Extension Chrome/Brave đọc văn bản trang web — highlight theo câu/từ, tự cuộn, hỗ trợ Google Docs (canvas).

## Tính năng

- **TTS:** Web Speech API (mặc định, miễn phí), **Edge TTS**, Azure Speech, Google Cloud TTS
- **Đọc từ vị trí:** hover **500ms** trên dòng/đoạn → nút ▶; đang đọc thì hiện ↪ để nhảy
- **Highlight & auto-scroll** theo tiến độ đọc
- **Toolbar** trên trang: pause, dừng, chỉnh tốc độ, “Back on track” khi tự cuộn bị lệch
- **Google Docs:** annotated canvas + SVG accessibility; double-click hoặc hover để bắt đầu
- **Context menu:** “Đọc từ đây” (chuột phải)
- **Popup:** “Đọc trang” (Brave cần bấm thêm nút xác nhận trên trang — gesture policy)

## Cài đặt (dev)

1. Mở `chrome://extensions` hoặc `brave://extensions`
2. Bật **Developer mode**
3. **Load unpacked** → chọn thư mục `brave-tts`
4. Sau mỗi lần sửa code → **Reload** extension

## Cách dùng

| Trang | Cách bắt đầu |
|-------|----------------|
| Web thường | Hover nửa giây trên đoạn → ▶ |
| Google Docs | Hover nửa giây hoặc **double-click** trên dòng |
| Popup | ▶ Đọc trang → bấm **Bắt đầu đọc** trên trang |
| Đang đọc | Hover chỗ khác → ↪ |

### Google Docs

1. **Reload tab Docs** sau khi reload extension (bootstrap chạy lúc trang load)
2. Nếu chưa đọc được: **Công cụ → Cài đặt trợ năng → Turn on screen reader support** (macOS: `Control + Option + T`)
3. Cuộn qua phần cần đọc nếu doc dài (lazy render)

## Cấu hình TTS (popup)

| Provider | Ghi chú |
|----------|---------|
| **Web Speech** | Không cần API key; giọng phụ thuộc OS/trình duyệt |
| **Edge TTS** | Miễn phí, giọng Microsoft Read Aloud (mặc định) |
| **Azure** | Key + region + voice (free tier có hạn) |
| **Google Cloud** | API key + voice |

Cài đặt lưu qua `chrome.storage.sync`.

## Cấu trúc project

```
brave-tts/
├── manifest.json
├── background/background.js      # Context menu, message routing
├── content/
│   ├── content.js                # Logic TTS, highlight, hover (chung)
│   ├── docs-content.js           # Hook Google Docs (chỉ load trên docs.google.com)
│   ├── content.css
│   ├── docs-bootstrap.js         # Inject sớm trên docs.google.com
│   └── docs-page.js              # Closure/SVG extract (page context)
├── popup/                        # UI cài đặt & điều khiển
├── shared/                       # edge-tts-client.js, i18n.js
├── icons/
└── test/                         # E2E Playwright (xem test/README.md)
```

## Phát triển & test

```bash
cd test
npm install
npm test              # Trang HTML local (hover, jump, back-on-track)
npm run test:edge     # Edge TTS iframe
npm run test:docs     # Google Docs (cần mạng)
npm run test:all      # Chạy cả 3
npm run serve         # http://127.0.0.1:8765/ — thử tay
```

Trang thử local: chạy `npm run serve` rồi mở `http://127.0.0.1:8765/` (không mở file `page.html` trực tiếp).

## Giới hạn đã biết

- **Brave:** TTS từ popup cần user gesture trên trang (nút xác nhận)
- **Google Docs:** Canvas mode; extension dùng `_docs_annotate_canvas_by_ext` + SVG `aria-label` — có thể thay đổi khi Google cập nhật
- **Highlight Docs:** ổn định nhất ở mức dòng/câu, không chính xác từng ký tự như HTML thuần

## License

Dùng nội bộ / cá nhân. Icon và tên “Brave” không liên kết chính thức với Brave Software.

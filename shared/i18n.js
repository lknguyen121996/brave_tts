/* global self, window */
// Guard against re-injection (popup injectAndStart re-injects this file)
if (typeof BRAVE_TTS_STRINGS !== "undefined") {
  if (typeof window !== "undefined") window.__braveTtsI18nLoaded = true;
  if (typeof self !== "undefined") self.__braveTtsI18nLoaded = true;
  /* return early — already loaded */
} else {
const BRAVE_TTS_STRINGS = {
  vi: {
    "popup.subtitle": "Đọc to, highlight & tự cuộn trang",
    "popup.headerHint":
      "Hover nửa giây trên dòng/đoạn để hiện ▶. Google Docs: thêm double-click để đọc ngay.",
    "popup.playPage": "▶ Đọc trang",
    "popup.stop": "■ Dừng",
    "popup.ttsProvider": "Nguồn TTS",
    "popup.provider.webspeech": "Web Speech (miễn phí, không cần key)",
    "popup.provider.edge": "Edge TTS (miễn phí, giọng Read Aloud)",
    "popup.provider.azure": "Azure Speech (free tier)",
    "popup.provider.google": "Google Cloud TTS (free tier)",
    "popup.readLang": "Ngôn ngữ đọc",
    "popup.readLangPlaceholder": "— Chọn ngôn ngữ —",
    "popup.readLangHint":
      "Chọn ngôn ngữ trước — danh sách giọng sẽ được tải theo ngôn ngữ này.",
    "popup.rateLabel": "Tốc độ đọc:",
    "popup.rateHint": "Có thể chỉnh thêm bằng thanh công cụ khi đang đọc.",
    "popup.voice": "Giọng đọc",
    "popup.voiceWebspeechHint":
      "Danh sách giọng lấy từ tab đang mở. Mở trang web trước, rồi mở lại popup nếu trống.",
    "popup.edgeVoice": "Giọng đọc",
    "popup.edgeVoiceHint": "Giọng neural giống Microsoft Edge Read Aloud — không cần API key.",
    "popup.azureSummary": "Azure Speech API",
    "popup.azureKey": "Subscription Key",
    "popup.azureKeyPlaceholder": "Azure Speech key",
    "popup.azureRegion": "Region",
    "popup.azureVoice": "Giọng đọc",
    "popup.googleSummary": "Google Cloud TTS",
    "popup.googleKey": "API Key",
    "popup.googleKeyPlaceholder": "Google Cloud API key",
    "popup.googleVoice": "Giọng đọc",
    "popup.uiLang": "Giao diện",
    "popup.lang.vi": "Tiếng Việt",
    "popup.lang.en": "English",
    "popup.lang.viVN": "Tiếng Việt",
    "popup.lang.enUS": "English (US)",
    "popup.lang.enGB": "English (UK)",
    "popup.lang.jaJP": "日本語",
    "popup.lang.koKR": "한국어",
    "popup.lang.zhCN": "中文",
    "voice.selectLangFirst": "Chọn ngôn ngữ trước",
    "voice.selectLangAndKey": "Chọn ngôn ngữ và nhập key trước",
    "voice.enterAzureKey": "Nhập Azure key trước",
    "voice.enterGoogleKey": "Nhập Google API key trước",
    "voice.loadingAzure": "Đang tải giọng Azure...",
    "voice.loadingGoogle": "Đang tải giọng Google...",
    "voice.loadingEdge": "Đang tải giọng Edge...",
    "voice.noneForLang": "Không có giọng cho ngôn ngữ này",
    "voice.noneDefaultForLang": "Không có giọng mặc định cho ngôn ngữ này",
    "status.fileUrlAccess":
      "Trang file:// cần bật 'Allow access to file URLs' tại brave://extensions.",
    "status.openWebForVoices": "Mở trang web để tải danh sách giọng Web Speech.",
    "status.openNormalWebForVoices":
      "Mở trang web thường để tải danh sách giọng Web Speech.",
    "status.voicesLoadFailed":
      "Không tải được danh sách giọng. Mở trang web thường rồi mở lại popup.",
    "status.voicesReloadFailed": "Không tải được giọng đọc. Reload trang web rồi mở lại popup.",
    "status.azureNoVoices": "Không tìm thấy giọng Azure cho ngôn ngữ này. Dùng danh sách mặc định.",
    "status.azureApiFailed": "Không tải được giọng Azure từ API. Dùng danh sách mặc định.",
    "status.googleNoVoices": "Không tìm thấy giọng Google cho ngôn ngữ này. Dùng danh sách mặc định.",
    "status.googleApiFailed": "Không tải được giọng Google từ API. Dùng danh sách mặc định.",
    "status.edgeNoVoices": "Không tìm thấy giọng Edge cho ngôn ngữ này. Dùng danh sách mặc định.",
    "status.edgeApiFailed": "Không tải được giọng Edge từ API. Dùng danh sách mặc định.",
    "status.selectReadLang": "Chọn ngôn ngữ trước khi đọc.",
    "status.enterAzureKey": "Nhập Azure Speech key trước khi đọc.",
    "status.selectAzureVoice": "Chọn giọng Azure trước khi đọc.",
    "status.enterGoogleKey": "Nhập Google Cloud API key trước khi đọc.",
    "status.selectGoogleVoice": "Chọn giọng Google trước khi đọc.",
    "status.selectEdgeVoice": "Chọn giọng Edge trước khi đọc.",
    "status.noActiveTab": "Không có tab active. Mở trang web rồi thử lại.",
    "status.blockedBrowserUrl":
      "Không đọc được trang nội bộ trình duyệt (brave://, chrome://).",
    "status.openingPrompt": "Đang mở hộp bắt đầu trên trang...",
    "status.clickStartOnPage": "Bấm 'Bắt đầu đọc' trên trang web.",
    "status.connectFailed":
      "Lỗi: không kết nối được trang. Thử reload trang hoặc bật quyền file URL tại brave://extensions.",
    "status.tabConnectFailed": "Không thể kết nối tab.",
    "status.stopped": "Đã dừng.",
    "content.noText": "Không tìm thấy văn bản để đọc trên trang này.",
    "content.noReadPosition": "Không xác định được vị trí đọc.",
    "content.noReadPositionInBlock": "Không xác định được vị trí đọc trong đoạn này.",
    "content.noReadPositionInSelection": "Không xác định được vị trí đọc trong vùng chọn.",
    "content.gestureDesc": "Brave cần một lần bấm trên trang để bật giọng đọc.",
    "content.gestureStart": "▶ Bắt đầu đọc",
    "content.gestureCancel": "Hủy",
    "content.readFromHere": "Đọc từ đây",
    "content.docsNotReady": "Chưa đọc được Docs. Cuộn qua đoạn cần đọc rồi thử lại.",
    "content.docsLineUnknown": "Không xác định được dòng đọc.",
    "content.docsDoubleClickText": "Double-click trực tiếp lên chữ trong document.",
    "content.docsScrollRetry": "Chưa đọc được Docs. Cuộn qua đoạn cần đọc rồi double-click lại.",
    "content.noReadPositionAtPoint": "Không xác định được vị trí đọc tại điểm này.",
    "content.rightClickToStart": "Hãy click chuột phải vào vị trí muốn bắt đầu đọc.",
    "content.docsHintDefault":
      "Docs canvas: hover nửa giây trên dòng hoặc double-click. Nếu chưa đọc được, bật Tools → Accessibility → Turn on screen reader support.",
    "content.backOnTrack": "Quay lại",
    "content.backOnTrackTitle": "Quay lại vị trí đang đọc và tự cuộn theo",
    "content.toolbarReady": "Sẵn sàng",
    "content.toolbarRate": "Tốc độ",
    "content.toolbarSlower": "Chậm hơn",
    "content.toolbarFaster": "Nhanh hơn",
    "content.toolbarPause": "Tạm dừng",
    "content.toolbarResume": "Tiếp tục",
    "content.toolbarStop": "Dừng",
    "content.statusReading": "Đang đọc...",
    "content.statusPreparing": "Đang chuẩn bị giọng đọc...",
    "content.statusPaused": "Đã tạm dừng",
    "content.statusComplete": "Hoàn thành",
    "content.statusErrorPrefix": "Lỗi: ",
    "error.azureKeyMissing": "Chưa nhập Azure Speech key",
    "error.googleKeyMissing": "Chưa nhập Google Cloud API key",
    "error.edgeVoiceMissing": "Chưa chọn giọng Edge",
    "error.webSpeechUnsupported": "Trình duyệt không hỗ trợ Web Speech",
    "contextMenu.readFromHere": "Đọc từ đây (Brave Read Aloud)",
  },
  en: {
    "popup.subtitle": "Read aloud with highlight & auto-scroll",
    "popup.headerHint":
      "Hover half a second on a line/paragraph for ▶. Google Docs: double-click to read instantly.",
    "popup.playPage": "▶ Read page",
    "popup.stop": "■ Stop",
    "popup.ttsProvider": "TTS source",
    "popup.provider.webspeech": "Web Speech (free, no key)",
    "popup.provider.edge": "Edge TTS (free, Read Aloud voices)",
    "popup.provider.azure": "Azure Speech (free tier)",
    "popup.provider.google": "Google Cloud TTS (free tier)",
    "popup.readLang": "Reading language",
    "popup.readLangPlaceholder": "— Select language —",
    "popup.readLangHint": "Select a language first — voices load for this language.",
    "popup.rateLabel": "Reading speed:",
    "popup.rateHint": "You can also adjust speed from the toolbar while reading.",
    "popup.voice": "Voice",
    "popup.voiceWebspeechHint":
      "Voices come from the active tab. Open a web page first, then reopen the popup if empty.",
    "popup.edgeVoice": "Voice",
    "popup.edgeVoiceHint": "Neural voices like Microsoft Edge Read Aloud — no API key required.",
    "popup.azureSummary": "Azure Speech API",
    "popup.azureKey": "Subscription Key",
    "popup.azureKeyPlaceholder": "Azure Speech key",
    "popup.azureRegion": "Region",
    "popup.azureVoice": "Voice",
    "popup.googleSummary": "Google Cloud TTS",
    "popup.googleKey": "API Key",
    "popup.googleKeyPlaceholder": "Google Cloud API key",
    "popup.googleVoice": "Voice",
    "popup.uiLang": "Interface",
    "popup.lang.vi": "Tiếng Việt",
    "popup.lang.en": "English",
    "popup.lang.viVN": "Vietnamese",
    "popup.lang.enUS": "English (US)",
    "popup.lang.enGB": "English (UK)",
    "popup.lang.jaJP": "Japanese",
    "popup.lang.koKR": "Korean",
    "popup.lang.zhCN": "Chinese",
    "voice.selectLangFirst": "Select a language first",
    "voice.selectLangAndKey": "Select language and enter key first",
    "voice.enterAzureKey": "Enter Azure key first",
    "voice.enterGoogleKey": "Enter Google API key first",
    "voice.loadingAzure": "Loading Azure voices...",
    "voice.loadingGoogle": "Loading Google voices...",
    "voice.loadingEdge": "Loading Edge voices...",
    "voice.noneForLang": "No voices for this language",
    "voice.noneDefaultForLang": "No default voices for this language",
    "status.fileUrlAccess":
      "file:// pages need 'Allow access to file URLs' enabled at brave://extensions.",
    "status.openWebForVoices": "Open a web page to load Web Speech voices.",
    "status.openNormalWebForVoices": "Open a normal web page to load Web Speech voices.",
    "status.voicesLoadFailed":
      "Could not load voices. Open a normal web page and reopen the popup.",
    "status.voicesReloadFailed": "Could not load voices. Reload the page and reopen the popup.",
    "status.azureNoVoices": "No Azure voices for this language. Using default list.",
    "status.azureApiFailed": "Could not load Azure voices from API. Using default list.",
    "status.googleNoVoices": "No Google voices for this language. Using default list.",
    "status.googleApiFailed": "Could not load Google voices from API. Using default list.",
    "status.edgeNoVoices": "No Edge voices for this language. Using default list.",
    "status.edgeApiFailed": "Could not load Edge voices from API. Using default list.",
    "status.selectReadLang": "Select a reading language before starting.",
    "status.enterAzureKey": "Enter Azure Speech key before reading.",
    "status.selectAzureVoice": "Select an Azure voice before reading.",
    "status.enterGoogleKey": "Enter Google Cloud API key before reading.",
    "status.selectGoogleVoice": "Select a Google voice before reading.",
    "status.selectEdgeVoice": "Select an Edge voice before reading.",
    "status.noActiveTab": "No active tab. Open a web page and try again.",
    "status.blockedBrowserUrl": "Cannot read internal browser pages (brave://, chrome://).",
    "status.openingPrompt": "Opening start prompt on the page...",
    "status.clickStartOnPage": "Click 'Start reading' on the web page.",
    "status.connectFailed":
      "Error: could not connect to the page. Reload the page or enable file URL access at brave://extensions.",
    "status.tabConnectFailed": "Could not connect to tab.",
    "status.stopped": "Stopped.",
    "content.noText": "No readable text found on this page.",
    "content.noReadPosition": "Could not determine reading position.",
    "content.noReadPositionInBlock": "Could not determine reading position in this block.",
    "content.noReadPositionInSelection": "Could not determine reading position in selection.",
    "content.gestureDesc": "Brave needs one click on the page to enable speech.",
    "content.gestureStart": "▶ Start reading",
    "content.gestureCancel": "Cancel",
    "content.readFromHere": "Read from here",
    "content.docsNotReady": "Docs not ready. Scroll through the section and try again.",
    "content.docsLineUnknown": "Could not determine line to read.",
    "content.docsDoubleClickText": "Double-click directly on text in the document.",
    "content.docsScrollRetry": "Docs not ready. Scroll through the section and double-click again.",
    "content.noReadPositionAtPoint": "Could not determine reading position at this point.",
    "content.rightClickToStart": "Right-click where you want to start reading.",
    "content.docsHintDefault":
      "Docs canvas: hover half a second on a line or double-click. If it fails, enable Tools → Accessibility → Turn on screen reader support.",
    "content.backOnTrack": "Back on track",
    "content.backOnTrackTitle": "Return to reading position and resume auto-scroll",
    "content.toolbarReady": "Ready",
    "content.toolbarRate": "Speed",
    "content.toolbarSlower": "Slower",
    "content.toolbarFaster": "Faster",
    "content.toolbarPause": "Pause",
    "content.toolbarResume": "Resume",
    "content.toolbarStop": "Stop",
    "content.statusReading": "Reading...",
    "content.statusPreparing": "Preparing speech...",
    "content.statusPaused": "Paused",
    "content.statusComplete": "Complete",
    "content.statusErrorPrefix": "Error: ",
    "error.azureKeyMissing": "Azure Speech key not entered",
    "error.googleKeyMissing": "Google Cloud API key not entered",
    "error.edgeVoiceMissing": "Edge voice not selected",
    "error.webSpeechUnsupported": "Browser does not support Web Speech",
    "contextMenu.readFromHere": "Read from here (Brave Read Aloud)",
  },
};

function braveTtsNormalizeUiLang(uiLang) {
  return uiLang === "en" ? "en" : "vi";
}

function braveTtsT(key, uiLang = "vi", params = {}) {
  const lang = braveTtsNormalizeUiLang(uiLang);
  let text = BRAVE_TTS_STRINGS[lang]?.[key] ?? BRAVE_TTS_STRINGS.en[key] ?? key;
  for (const [name, value] of Object.entries(params)) {
    text = text.replaceAll(`{${name}}`, String(value));
  }
  return text;
}

function braveTtsApplyDom(root, uiLang) {
  const scope = root || (typeof document !== "undefined" ? document : null);
  if (!scope) return;

  scope.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = braveTtsT(el.dataset.i18n, uiLang);
  });

  scope.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.placeholder = braveTtsT(el.dataset.i18nPlaceholder, uiLang);
  });

  scope.querySelectorAll("option[data-i18n]").forEach((el) => {
    el.textContent = braveTtsT(el.dataset.i18n, uiLang);
  });

  scope.querySelectorAll("summary[data-i18n]").forEach((el) => {
    el.textContent = braveTtsT(el.dataset.i18n, uiLang);
  });
}

const braveTtsI18nExport = {
  BRAVE_TTS_STRINGS,
  braveTtsNormalizeUiLang,
  braveTtsT,
  braveTtsApplyDom,
};

if (typeof self !== "undefined") {
  self.braveTtsNormalizeUiLang = braveTtsNormalizeUiLang;
  self.braveTtsT = braveTtsT;
  self.braveTtsApplyDom = braveTtsApplyDom;
  self.BRAVE_TTS_STRINGS = BRAVE_TTS_STRINGS;
}

if (typeof window !== "undefined") {
  window.braveTtsNormalizeUiLang = braveTtsNormalizeUiLang;
  window.braveTtsT = braveTtsT;
  window.braveTtsApplyDom = braveTtsApplyDom;
  window.BRAVE_TTS_STRINGS = BRAVE_TTS_STRINGS;
}
} // end guard block

importScripts("../shared/i18n.js", "edge-tts-session-rules.js");

const DEFAULT_SETTINGS = {
  uiLang: "en",
  provider: "webspeech",
  rate: 1,
  lang: "en-US",
  voice: "",
  azureKey: "",
  azureRegion: "southeastasia",
  azureVoice: "en-US-JennyNeural",
  googleKey: "",
  googleVoice: "en-US-Neural2-F",
  edgeVoice: "en-US-JennyNeural",
};

function ensureContextMenu() {
  chrome.storage.sync.get(["uiLang"], ({ uiLang }) => {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: "brave-tts-read-from-here",
        title: braveTtsT("contextMenu.readFromHere", uiLang),
        contexts: ["page", "selection"],
      });
    });
  });
}

chrome.runtime.onInstalled.addListener(({ reason }) => {
  ensureEdgeTtsWsHeaders().catch(() => {});
  if (reason === "install") {
    chrome.storage.sync.set(DEFAULT_SETTINGS);
  } else {
    chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS), (existing) => {
      const merged = { ...DEFAULT_SETTINGS };
      for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (existing[key] !== undefined && existing[key] !== "") {
          merged[key] = existing[key];
        }
      }
      chrome.storage.sync.set(merged);
    });
  }
  ensureContextMenu();
});

chrome.runtime.onStartup.addListener(() => {
  ensureEdgeTtsWsHeaders().catch(() => {});
  ensureContextMenu();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.uiLang) ensureContextMenu();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "brave-tts-read-from-here" || !tab?.id) return;
  chrome.tabs.sendMessage(tab.id, {
    type: "READ_FROM_HERE",
    useSelection: Boolean(info.selectionText),
  });
});

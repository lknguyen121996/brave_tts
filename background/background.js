importScripts("../shared/i18n.js", "edge-tts-session-rules.js");

const DEFAULT_SETTINGS = {
  uiLang: "vi",
  provider: "webspeech",
  rate: 1,
  lang: "vi-VN",
  voice: "",
  azureKey: "",
  azureRegion: "southeastasia",
  azureVoice: "vi-VN-HoaiMyNeural",
  googleKey: "",
  googleVoice: "vi-VN-Neural2-A",
  edgeVoice: "vi-VN-HoaiMyNeural",
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

function injectDocsAnnotate(tabId) {
  if (!tabId) return;
  chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: (extId) => {
      try {
        window._docs_annotate_canvas_by_ext = extId;
      } catch {
        /* ignore */
      }
    },
    args: [chrome.runtime.id],
  }).catch(() => {});
}

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== "loading" && info.status !== "complete") return;
  if (!tab.url?.includes("docs.google.com/document/")) return;
  injectDocsAnnotate(tabId);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "brave-tts-read-from-here" || !tab?.id) return;
  chrome.tabs.sendMessage(tab.id, {
    type: "READ_FROM_HERE",
    useSelection: Boolean(info.selectionText),
  });
});

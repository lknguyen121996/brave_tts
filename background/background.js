const DEFAULT_SETTINGS = {
  provider: "webspeech",
  rate: 1,
  lang: "vi-VN",
  voice: "",
  azureKey: "",
  azureRegion: "southeastasia",
  azureVoice: "vi-VN-HoaiMyNeural",
  googleKey: "",
  googleVoice: "vi-VN-Neural2-A",
};

function ensureContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "brave-tts-read-from-here",
      title: "Đọc từ đây (Brave Read Aloud)",
      contexts: ["page", "selection"],
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.set(DEFAULT_SETTINGS);
  ensureContextMenu();
});

chrome.runtime.onStartup.addListener(ensureContextMenu);

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "brave-tts-read-from-here" || !tab?.id) return;
  chrome.tabs.sendMessage(tab.id, {
    type: "READ_FROM_HERE",
    useSelection: Boolean(info.selectionText),
  });
});

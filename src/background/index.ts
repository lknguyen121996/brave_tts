// ============================================================
// Stateless Service Worker — Brave Read Aloud V2
// ============================================================
//
// The service worker is a "speaker" (cái loa): it receives TTS
// speech requests from the content script, speaks via chrome.tts,
// and forwards word/sentence/end events back.
//
// It is STATELESS: no text, index, or settings stored. If killed,
// the content script detects this and sends a RESUME_PAYLOAD to
// re-sync. The SW processes it and continues as if nothing happened.
//
// Additional roles:
// - Relay: Popup control messages → Content Script
// - Context menu: "Read from here" → Content Script
// - Install/Startup: initialize default settings + context menu
//
// See DECISIONS.md § "Stateless Service Worker"

import { ttsManager } from "@background/ttsManager";
import type {
  ToContentScriptMessage,
  FromContentScriptMessage,
  TtsSpeakRequest,
  ResumePayload,
  TtsSettings,
} from "@shared/types";

// ---- Default Settings (mirrors V1) ----

const DEFAULT_SETTINGS: TtsSettings = {
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

// ---- Helpers ----

/** Get the currently active tab (or null if unavailable) */
async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  return tab ?? null;
}

/**
 * Forward a message to the content script of a tab.
 * Returns the response from the content script, or null on failure.
 */
async function forwardToTab(
  tabId: number,
  message: ToContentScriptMessage
): Promise<unknown> {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    // Tab may not have content script injected (e.g., chrome:// pages)
    return null;
  }
}

// ---- TTS Speech Handler (CS → SW → chrome.tts) ----

/** Build chrome.tts.SpeakOptions from our TtsSettings */
function buildTtsOptions(settings: TtsSettings): chrome.tts.SpeakOptions {
  return {
    lang: settings.lang || undefined,
    rate: settings.rate || 1,
    voiceName: settings.voice || undefined,
    // Request word boundaries for precise highlight tracking
    desiredEventTypes: ["start", "end", "word", "sentence", "error"],
  };
}

async function handleTtsSpeak(
  msg: TtsSpeakRequest,
  senderTabId: number
): Promise<{ ok: boolean; error?: string }> {
  try {
    const options = buildTtsOptions(msg.settings);
    await ttsManager.speak(msg.text, options, senderTabId);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "tts speak failed",
    };
  }
}

function handleTtsStop(): { ok: boolean } {
  ttsManager.stop();
  return { ok: true };
}

function handleResumePayload(_msg: ResumePayload): { ok: boolean } {
  // SW is stateless — nothing to restore.
  // Content script will re-send TTS_SPEAK when ready.
  // We just acknowledge so CS knows we're alive.
  return { ok: true };
}

// ---- Context Menu ----

function ensureContextMenu(): void {
  chrome.storage.sync.get(["uiLang"], ({ uiLang }) => {
    const lang = uiLang || "en";
    const title =
      lang === "vi" ? "Đọc từ đây" : "Read from here";

    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: "brave-tts-read-from-here",
        title,
        contexts: ["page", "selection"],
      });
    });
  });
}

// ---- Message Router ----

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const msg = message as
    | ToContentScriptMessage
    | FromContentScriptMessage;

  // --- Messages FROM Content Script (CS → SW) ---

  if (msg.type === "TTS_SPEAK") {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse({ ok: false, error: "no tab id" });
      return false;
    }
    handleTtsSpeak(msg as TtsSpeakRequest, tabId).then(sendResponse);
    return true; // async response
  }

  if (msg.type === "TTS_STOP") {
    sendResponse(handleTtsStop());
    return false;
  }

  if (msg.type === "RESUME_PAYLOAD") {
    sendResponse(handleResumePayload(msg as ResumePayload));
    return false;
  }

  // --- Messages FROM Popup (relay to Content Script) ---

  // These messages go to the content script. The popup sends them
  // via chrome.runtime.sendMessage, and we forward to the active tab.
  if (
    msg.type === "START_READING" ||
    msg.type === "STOP_READING" ||
    msg.type === "PAUSE_READING" ||
    msg.type === "RESUME_READING" ||
    msg.type === "SET_RATE" ||
    msg.type === "GET_VOICES" ||
    msg.type === "GET_STATUS"
  ) {
    // If sender is from a tab, it's a content script (shouldn't happen for these)
    // If sender has no tab, it's from popup
    if (!sender.tab) {
      getActiveTab().then((tab) => {
        if (tab?.id) {
          forwardToTab(tab.id, msg as ToContentScriptMessage).then(
            (response) => sendResponse(response ?? { ok: false })
          );
        } else {
          sendResponse({ ok: false, error: "no active tab" });
        }
      });
      return true; // async
    }
  }

  return false;
});

// ---- Context Menu Click ----

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "brave-tts-read-from-here" || !tab?.id) return;
  const message: ToContentScriptMessage = {
    type: "READ_FROM_HERE",
    useSelection: Boolean(info.selectionText),
  };
  forwardToTab(tab.id, message);
});

// ---- Install / Startup ----

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") {
    chrome.storage.sync.set(DEFAULT_SETTINGS);
  } else if (reason === "update") {
    // Merge new defaults with existing settings
    chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS), (existing) => {
      const merged = { ...DEFAULT_SETTINGS };
      for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof TtsSettings)[]) {
        if (existing[key] !== undefined && existing[key] !== "") {
          (merged as Record<string, unknown>)[key] = existing[key];
        }
      }
      chrome.storage.sync.set(merged);
    });
  }
  ensureContextMenu();
});

chrome.runtime.onStartup.addListener(() => {
  ensureContextMenu();
});

// Update context menu title when language changes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.uiLang) {
    ensureContextMenu();
  }
});

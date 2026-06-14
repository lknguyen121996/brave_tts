// ============================================================
// Service Worker — Brave Read Aloud V2
// ============================================================
//
// Stateless "loudspeaker" worker:
//   1. Registers DNR rules for PDF/EPUB interception (v2-03)
//   2. Creates context menu "Read from here" entry
//   3. Routes popup ↔ content script messages
//   4. Handles TTS speak/stop via chrome.tts API (v2-02)
//
// State is NOT persisted here — the content script owns
// playback state and the LookupTable. When the SW is killed
// (~30s idle), the CS resends [text, startIndex] to resume.
//
// See: DECISIONS.md § "Stateless Service Worker"

import { initDnrRules } from "@background/dnrRules";
import type { FileUrlDetectedMessage } from "@shared/types";

// ---- Constants ----

const CONTEXT_MENU_ID = "brave-tts-read-from-here";

// ---- Context Menu ----

function ensureContextMenu(): void {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: CONTEXT_MENU_ID,
      title: "Đọc từ đây",
      contexts: ["page", "selection"],
      documentUrlPatterns: ["<all_urls>"],
    });
  });
}

// ---- Message Routing ----

function handleMessage(
  msg: unknown,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void
): boolean {
  if (!msg || typeof msg !== "object" || !("type" in msg)) {
    return false;
  }

  const message = msg as { type: string };
  const tabId = _sender.tab?.id;

  switch (message.type) {
    // --- Messages FROM Popup → Forward to Content Script ---
    case "START_READING":
    case "READ_FROM_HERE":
    case "STOP_READING":
    case "PAUSE_READING":
    case "RESUME_READING":
    case "SET_RATE":
    case "GET_VOICES":
    case "GET_STATUS": {
      if (tabId == null) {
        sendResponse({ error: "No active tab" });
        return false;
      }
      chrome.tabs.sendMessage(tabId, msg).then(sendResponse).catch(() => {
        sendResponse({ error: "Content script not ready" });
      });
      return true; // async response
    }

    // --- Messages FROM Content Script ---
    // v2-02: Handle TTS_SPEAK, TTS_STOP, RESUME_PAYLOAD here

    // --- v2-03: FILE_URL_DETECTED ---
    case "FILE_URL_DETECTED": {
      const fileMsg = message as FileUrlDetectedMessage;
      // Acknowledge; popup can query this state for onboarding UI
      console.debug(
        "[Brave Read Aloud] file:// URL detected:",
        fileMsg.url
      );
      sendResponse({ ok: true });
      return false;
    }

    default:
      return false;
  }
}

// ---- Context Menu Click ----

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID) return;
  if (!tab?.id) return;

  // Detect context: if selectionText is present, read the selection;
  // otherwise start reading from the pointer position (page context).
  const useSelection = typeof info.selectionText === "string";
  const message = useSelection
    ? { type: "READ_FROM_HERE" as const, useSelection: true }
    : { type: "READ_FROM_HERE" as const, useSelection: false };

  chrome.tabs.sendMessage(tab.id, message).catch(() => {
    // Content script may not be injected yet (e.g., chrome:// pages)
  });
});

// ---- Install & Startup ----

chrome.runtime.onInstalled.addListener(() => {
  ensureContextMenu();
  initDnrRules(); // fire-and-forget — DNR rules are non-critical
});

chrome.runtime.onStartup.addListener(() => {
  ensureContextMenu();
  initDnrRules(); // re-register (may have been cleared on browser restart)
});

// ---- Message Listener ----

chrome.runtime.onMessage.addListener(handleMessage);

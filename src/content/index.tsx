// ============================================================
// Content Script Entry — Brave Read Aloud V2
// ============================================================
//
// Injected into every page (all_urls). Responsibilities:
// 1. Create a Shadow DOM host + React root (style isolation)
// 2. Mount the toolbar + hover button UI
// 3. Listen for control messages (START_READING, STOP, etc.)
// 4. Listen for TTS events from the service worker
// 5. Coordinate with the active adapter for text extraction
//
// Double-injection guard: window.__braveTtsV2Loaded
//
// See DECISIONS.md § "Shadow DOM isolation"

import React from "react";
import { createRoot, Root } from "react-dom/client";
import { App } from "./components/App";
import { injectStyles } from "./styles";
import type {
  ToContentScriptMessage,
  TtsEventMessage,
  ResumePayload,
  TtsSettings,
} from "@shared/types";

// ---- Type-safe window extension ----

declare global {
  interface Window {
    __braveTtsV2Loaded?: boolean;
  }
}

// ---- Guards ----

if (window.__braveTtsV2Loaded) {
  // Already injected (e.g., extension reload)
  console.debug("[Brave Read Aloud] Content script already loaded, skipping");
  // Don't return — we still need to re-mount if the old root was removed
}

// ---- Shadow DOM Setup ----

const HOST_ID = "brave-tts-root";

/** Create the shadow host element and attach to document */
function createHost(): HTMLDivElement {
  let host = document.getElementById(HOST_ID) as HTMLDivElement | null;
  if (host) return host;

  host = document.createElement("div");
  host.id = HOST_ID;
  document.body.appendChild(host);
  return host;
}

/** Open a shadow root on the host, inject isolation styles */
function setupShadowRoot(host: HTMLElement): ShadowRoot {
  const shadow = host.attachShadow({ mode: "closed" });

  // Reset all inherited styles
  const reset = document.createElement("style");
  reset.textContent = `
    :host {
      all: initial;
      position: fixed;
      top: 0;
      left: 0;
      width: 0;
      height: 0;
      z-index: 2147483647;
      pointer-events: none;
    }
  `;
  shadow.appendChild(reset);

  // Inject our component styles
  injectStyles(shadow);

  return shadow;
}

// ---- React Mount ----

let reactRoot: Root | null = null;

function mount(): void {
  const host = createHost();
  const shadow = setupShadowRoot(host);

  // Create a mount point inside the shadow
  const mountPoint = document.createElement("div");
  mountPoint.id = "brave-tts-app";
  shadow.appendChild(mountPoint);

  reactRoot = createRoot(mountPoint);
  reactRoot.render(React.createElement(App));
}

function unmount(): void {
  if (reactRoot) {
    reactRoot.unmount();
    reactRoot = null;
  }
  const host = document.getElementById(HOST_ID);
  if (host) host.remove();
  delete window.__braveTtsV2Loaded;
}

// ---- Message Handling ----

/**
 * Handle messages from the service worker.
 * Returns true if the message was handled (for async sendResponse).
 */
function handleMessage(
  msg: ToContentScriptMessage | TtsEventMessage,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void
): boolean {
  switch (msg.type) {
    case "START_READING":
      // Will be wired up in v2-09: trigger adapter extraction + begin playback
      sendResponse({ ok: true });
      return false;

    case "STOP_READING":
      // Will be wired up in v2-09
      sendResponse({ ok: true });
      return false;

    case "PAUSE_READING":
      // Will be wired up in v2-09
      sendResponse({ ok: true });
      return false;

    case "RESUME_READING":
      // Will be wired up in v2-09
      sendResponse({ ok: true });
      return false;

    case "SET_RATE":
      // Will be wired up in v2-09
      sendResponse({ ok: true });
      return false;

    case "GET_STATUS":
      sendResponse({
        type: "STATUS_RESPONSE",
        running: false,
        paused: false,
        total: 0,
        current: 0,
        rate: 1,
      });
      return false;

    case "GET_VOICES":
      if (window.speechSynthesis) {
        const voices = window.speechSynthesis.getVoices();
        sendResponse({
          type: "VOICES_RESPONSE",
          voices: voices.map((v) => ({ name: v.name, lang: v.lang })),
        });
      } else {
        sendResponse({ type: "VOICES_RESPONSE", voices: [] });
      }
      return false;

    case "READ_FROM_HERE":
      // Will be wired up in v2-09
      sendResponse({ ok: true });
      return false;

    // TTS events from SW (event stream)
    case "TTS_EVENT":
      // Will be wired up in v2-09: update highlight position
      // For now, just acknowledge
      return false;

    default:
      return false;
  }
}

// ---- Lifecycle ----

function init(): void {
  mount();

  if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener(handleMessage);
  }

  // Detect extension context invalidation
  if (typeof chrome !== "undefined" && chrome.runtime?.id) {
    const checkAlive = setInterval(() => {
      if (!chrome.runtime?.id) {
        clearInterval(checkAlive);
        unmount();
      }
    }, 5000);
  }
}

// Guard against double injection at the top level
if (!window.__braveTtsV2Loaded) {
  window.__braveTtsV2Loaded = true;
  init();
}

// ============================================================
// TtsManager — Stateless TTS wrapper around chrome.tts
// ============================================================
//
// Responsibilities:
// - Receive speak requests with text + options + target tabId
// - Call chrome.tts.speak() with per-utterance onEvent callback
// - Forward word/sentence/end/error events to the content script
// - Support stop (cancels current utterance via token invalidation)
//
// The manager is STATELESS: it does NOT store text, index, or
// playback position. The content script owns all state and sends
// discrete TTS_SPEAK commands as it advances through the document.
//
// See DECISIONS.md § "Stateless Service Worker"

import type { TtsEventMessage, TtsEventType } from "@shared/types";

// ---- Constants ----

/** Max chars per chrome.tts.speak() call (limit: 32,768) */
const MAX_UTTERANCE_LENGTH = 32000;

// Map chrome.tts event types to our internal TtsEventType.
// Types not listed here (marker, pause, resume) are forwarded as-is
// but the content script ignores unknown types.
const EVENT_TYPE_MAP: Record<string, TtsEventType> = {
  start: "start",
  end: "end",
  word: "word",
  sentence: "sentence",
  error: "error",
};

// ---- TTS Manager Class ----

class TtsManager {
  /** Token incremented on each new speak; callbacks discard stale events */
  private token = 0;

  /** Tab ID of the content script that requested the current speech */
  private activeTabId: number | null = null;

  /** Lookahead queue for pre-buffering the next utterance (max 1 entry) */
  private nextQueue: string[] = [];
  private readonly MAX_QUEUE_SIZE = 1;

  /** Options cached for the queued next utterance */
  private nextOptions: chrome.tts.SpeakOptions | null = null;

  /** Tab ID cached for the queued next utterance */
  private nextTabId: number | null = null;

  // ---- Public API ----

  /**
   * Queue the next utterance text for lookahead pre-buffering.
   *
   * Call this BEFORE the current utterance finishes so the TTS engine
   * can pre-buffer the next sentence and eliminate inter-sentence gaps.
   *
   * @param text    — plain text or SSML (max 32k chars)
   * @param options — voice, lang, rate, pitch, volume
   * @param tabId   — tab to send TtsEvent messages to
   */
  queueNext(
    text: string,
    options: chrome.tts.SpeakOptions,
    tabId: number
  ): void {
    if (this.nextQueue.length < this.MAX_QUEUE_SIZE) {
      this.nextQueue.push(text);
      this.nextOptions = options;
      this.nextTabId = tabId;
    }
  }

  /**
   * Speak text via chrome.tts and forward events to the content script.
   *
   * Stops any in-progress speech first. The returned promise resolves
   * when speech starts (or rejects on immediate error).
   *
   * @param text      — plain text or SSML (max 32k chars)
   * @param options   — voice, lang, rate, pitch, volume
   * @param tabId     — tab to send TtsEvent messages to
   */
  speak(
    text: string,
    options: chrome.tts.SpeakOptions,
    tabId: number
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      // Truncate if needed (chrome.tts hard limit is 32768)
      const safeText =
        text.length > MAX_UTTERANCE_LENGTH
          ? text.slice(0, MAX_UTTERANCE_LENGTH)
          : text;

      // Cancel previous speech
      this.stopInternal();
      chrome.tts.stop();

      // Fresh token for this utterance
      this.token += 1;
      const token = this.token;
      this.activeTabId = tabId;

      let started = false;

      const onEvent = (event: chrome.tts.TtsEvent): void => {
        // Guard against stale events from cancelled utterances
        if (token !== this.token) return;

        // Map chrome.tts event type to our internal type
        const eventType =
          EVENT_TYPE_MAP[event.type] || (event.type as TtsEventType);

        // Build and send the event message to content script
        const message: TtsEventMessage = {
          type: "TTS_EVENT",
          eventType,
        };
        if (event.charIndex !== undefined && event.charIndex >= 0) {
          message.charIndex = event.charIndex;
        }
        if (event.length !== undefined && event.length >= 0) {
          message.charLength = event.length;
        }
        if (event.errorMessage) {
          message.error = event.errorMessage;
        }

        // Fire-and-forget: content script may not be listening
        chrome.tabs.sendMessage(tabId, message).catch(() => {});

        // Resolve on first event
        if (!started) {
          started = true;
          if (eventType === "error") {
            reject(
              new Error(event.errorMessage || "chrome.tts speak error")
            );
          } else {
            resolve();
          }
        }
      };

      try {
        chrome.tts.speak(safeText, { ...options, onEvent });
        // Pre-buffer the next utterance if one was queued via queueNext()
        this.tryPreBuffer();
      } catch (err) {
        reject(err);
      }
    });
  }

  /** Stop current speech, clear lookahead queue, and invalidate the token */
  stop(): void {
    this.nextQueue = [];
    this.nextOptions = null;
    this.nextTabId = null;
    this.stopInternal();
    chrome.tts.stop();
  }

  /** Check if chrome.tts engine is currently speaking */
  isSpeaking(): Promise<boolean> {
    return new Promise((resolve) => {
      chrome.tts.isSpeaking((speaking) => resolve(speaking));
    });
  }

  /** Reset all internal state including lookahead queue */
  destroy(): void {
    this.nextQueue = [];
    this.nextOptions = null;
    this.nextTabId = null;
    this.stop();
    this.activeTabId = null;
  }

  /** Expose the current token for testing */
  get currentToken(): number {
    return this.token;
  }

  /** Expose the active tab ID for testing */
  get currentTabId(): number | null {
    return this.activeTabId;
  }

  // ---- Private ----

  /**
   * Dequeue and pre-buffer the next utterance via chrome.tts with
   * enqueue: true, so the TTS engine can start it immediately after
   * the current utterance finishes — eliminating inter-sentence gaps.
   *
   * The queued utterance shares the current token for event forwarding.
   * If stop() is called before it plays, chrome.tts.stop() clears the
   * engine queue and the token is bumped, so stale events are discarded.
   */
  private tryPreBuffer(): void {
    const nextText = this.nextQueue.shift();
    if (!nextText || !this.nextOptions || this.nextTabId === null) return;

    const tabId = this.nextTabId;
    const token = this.token;

    const safeText =
      nextText.length > MAX_UTTERANCE_LENGTH
        ? nextText.slice(0, MAX_UTTERANCE_LENGTH)
        : nextText;

    const onEvent = (event: chrome.tts.TtsEvent): void => {
      // Discard events if stop() invalidated the token
      if (token !== this.token) return;

      const eventType =
        EVENT_TYPE_MAP[event.type] || (event.type as TtsEventType);

      const message: TtsEventMessage = {
        type: "TTS_EVENT",
        eventType,
      };
      if (event.charIndex !== undefined && event.charIndex >= 0) {
        message.charIndex = event.charIndex;
      }
      if (event.length !== undefined && event.length >= 0) {
        message.charLength = event.length;
      }
      if (event.errorMessage) {
        message.error = event.errorMessage;
      }

      chrome.tabs.sendMessage(tabId, message).catch(() => {});
    };

    chrome.tts.speak(safeText, {
      ...this.nextOptions,
      enqueue: true,
      onEvent,
    });

    this.nextOptions = null;
    this.nextTabId = null;
  }

  private stopInternal(): void {
    this.token += 1;
  }
}

// Singleton — one manager per service worker lifecycle
export const ttsManager = new TtsManager();

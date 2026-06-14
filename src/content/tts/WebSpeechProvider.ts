// ============================================================
// WebSpeechProvider — Browser Speech Synthesis API
// ============================================================
//
// Uses window.speechSynthesis for TTS. Only works in content
// script context (requires DOM). Free, no API key needed.
//
// Ported from V1 content.js: speakWebSpeech()

import type { TtsSettings } from "@shared/types";
import type { ITtsProvider, TtsCallbacks, TtsAbortSignal } from "./ITtsProvider";

export class WebSpeechProvider implements ITtsProvider {
  readonly provider = "webspeech" as const;

  private currentUtterance: SpeechSynthesisUtterance | null = null;

  speak(
    text: string,
    settings: TtsSettings,
    callbacks: TtsCallbacks,
    signal?: TtsAbortSignal
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!window.speechSynthesis) {
        reject(new Error("Web Speech API not supported"));
        return;
      }

      // Check for early abort
      if (signal?.aborted) {
        reject(new Error("aborted"));
        return;
      }

      // Cancel any previous speech
      window.speechSynthesis.cancel();

      const utter = new SpeechSynthesisUtterance(text);
      this.currentUtterance = utter;

      // Configure voice
      const lang = settings.lang || "en-US";
      utter.lang = lang;
      utter.rate = Number(settings.rate) || 1;

      if (settings.voice) {
        const voices = window.speechSynthesis.getVoices();
        const voice = voices.find((v) => v.name === settings.voice);
        if (voice) utter.voice = voice;
      } else {
        // Pick first voice matching the language
        const voices = window.speechSynthesis.getVoices();
        const langBase = lang.split("-")[0];
        const voice =
          voices.find((v) => v.lang === lang) ??
          voices.find((v) => v.lang.startsWith(langBase ?? ""));
        if (voice) utter.voice = voice;
      }

      // Watchdog: if speech never starts, reject
      const watchdog = setTimeout(() => {
        if (
          !window.speechSynthesis.speaking &&
          !window.speechSynthesis.pending
        ) {
          reject(new Error("not-allowed"));
        }
      }, 2500);

      // Word boundary → highlight tracking
      utter.onboundary = (e: SpeechSynthesisEvent) => {
        if (e.charIndex !== undefined) {
          callbacks.onBoundary?.(e.charIndex, e.charLength ?? 0);
        }
      };

      utter.onend = () => {
        clearTimeout(watchdog);
        this.currentUtterance = null;
        callbacks.onEnd?.();
        resolve();
      };

      utter.onerror = (e: SpeechSynthesisErrorEvent) => {
        clearTimeout(watchdog);
        this.currentUtterance = null;
        const err = e.error || "speech error";
        if (err === "interrupted" || signal?.aborted) {
          reject(new Error("aborted"));
        } else {
          callbacks.onError?.(err);
          reject(new Error(err));
        }
      };

      // Abort checking via polling
      let abortInterval: ReturnType<typeof setInterval> | null = null;
      let settled = false;

      const settle = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(watchdog);
        if (abortInterval) {
          clearInterval(abortInterval);
          abortInterval = null;
        }
      };

      if (signal) {
        abortInterval = setInterval(() => {
          if (signal.aborted) {
            settle();
            window.speechSynthesis.cancel();
            reject(new Error("aborted"));
          }
        }, 100);
      }

      utter.onend = () => {
        settle();
        callbacks.onEnd?.();
        resolve();
      };

      utter.onerror = (e: SpeechSynthesisErrorEvent) => {
        settle();
        const err = e.error || "speech error";
        if (err === "interrupted") {
          reject(new Error("aborted"));
        } else {
          callbacks.onError?.(err);
          reject(new Error(err));
        }
      };

      window.speechSynthesis.speak(utter);
    });
  }

  stop(): void {
    window.speechSynthesis?.cancel();
    this.currentUtterance = null;
  }
}

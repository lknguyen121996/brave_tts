// ============================================================
// GoogleProvider — Google Cloud TTS via REST API
// ============================================================
//
// Sends synthesize request to texttospeech.googleapis.com,
// receives base64-encoded MP3, plays via Audio element.
//
// Ported from V1 content.js: speakGoogle()

import type { TtsSettings } from "@shared/types";
import type { ITtsProvider, TtsCallbacks, TtsAbortSignal } from "./ITtsProvider";

export class GoogleProvider implements ITtsProvider {
  readonly provider = "google" as const;

  private currentAudio: HTMLAudioElement | null = null;

  async speak(
    text: string,
    settings: TtsSettings,
    callbacks: TtsCallbacks,
    signal?: TtsAbortSignal
  ): Promise<void> {
    const { googleKey, googleVoice, rate, lang } = settings;

    if (!googleKey) throw new Error("Google Cloud API key not configured");

    const languageCode = lang || "en-US";
    const voiceName = googleVoice || "en-US-Neural2-F";
    const speakingRate = Number(rate) || 1;

    if (signal?.aborted) throw new Error("aborted");

    const res = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${googleKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: { text },
          voice: {
            languageCode,
            name: voiceName,
          },
          audioConfig: {
            audioEncoding: "MP3",
            speakingRate,
          },
        }),
      }
    );

    if (signal?.aborted) throw new Error("aborted");

    if (!res.ok) {
      throw new Error(`Google TTS: HTTP ${res.status}`);
    }

    const data = (await res.json()) as { audioContent?: string };

    if (signal?.aborted) throw new Error("aborted");

    if (!data.audioContent) {
      throw new Error("Google TTS: no audio content in response");
    }

    // Decode base64 → Uint8Array → Blob → URL
    const binary = atob(data.audioContent);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    const blob = new Blob([bytes], { type: "audio/mp3" });
    const url = URL.createObjectURL(blob);

    try {
      await this.playAudio(url, speakingRate, callbacks, signal);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  stop(): void {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.removeAttribute("src");
      this.currentAudio.load();
      this.currentAudio = null;
    }
  }

  /** Play audio from a blob URL with rate control */
  private playAudio(
    url: string,
    rate: number,
    callbacks: TtsCallbacks,
    signal?: TtsAbortSignal
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const audio = new Audio(url);
      this.currentAudio = audio;

      audio.playbackRate = rate;

      const cleanup = (): void => {
        audio.removeEventListener("ended", onEnd);
        audio.removeEventListener("error", onError);
        this.currentAudio = null;
      };

      const onEnd = (): void => {
        cleanup();
        callbacks.onEnd?.();
        resolve();
      };

      const onError = (): void => {
        cleanup();
        const err = audio.error?.message || "playback error";
        callbacks.onError?.(err);
        reject(new Error(err));
      };

      audio.addEventListener("ended", onEnd);
      audio.addEventListener("error", onError);

      // Abort polling
      if (signal) {
        const checkAbort = setInterval(() => {
          if (signal.aborted) {
            clearInterval(checkAbort);
            cleanup();
            audio.pause();
            reject(new Error("aborted"));
          }
        }, 100);
        audio.addEventListener("ended", () => clearInterval(checkAbort));
        audio.addEventListener("error", () => clearInterval(checkAbort));
      }

      audio.play().catch((err) => {
        cleanup();
        reject(err);
      });
    });
  }
}

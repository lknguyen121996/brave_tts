// ============================================================
// AzureProvider — Azure Speech SDK via REST API
// ============================================================
//
// Sends SSML to Azure Cognitive Services, receives MP3 audio,
// plays via Audio element. Requires API key + region.
//
// Ported from V1 content.js: speakAzure()

import type { TtsSettings } from "@shared/types";
import type { ITtsProvider, TtsCallbacks, TtsAbortSignal } from "./ITtsProvider";
import { escapeXml } from "./ITtsProvider";

export class AzureProvider implements ITtsProvider {
  readonly provider = "azure" as const;

  private currentAudio: HTMLAudioElement | null = null;

  async speak(
    text: string,
    settings: TtsSettings,
    callbacks: TtsCallbacks,
    signal?: TtsAbortSignal
  ): Promise<void> {
    const { azureKey, azureRegion, azureVoice, rate, lang } = settings;

    if (!azureKey) throw new Error("Azure Speech key not configured");

    const ssmlLang = lang || "en-US";
    const voiceName = azureVoice || "en-US-JennyNeural";
    const speakingRate = Number(rate) || 1;

    const ssml = `<speak version="1.0" xml:lang="${ssmlLang}">
      <voice name="${voiceName}">
        <prosody rate="${speakingRate}">${escapeXml(text)}</prosody>
      </voice>
    </speak>`;

    if (signal?.aborted) throw new Error("aborted");

    const region = azureRegion || "southeastasia";
    const res = await fetch(
      `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`,
      {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": azureKey,
          "Content-Type": "application/ssml+xml",
          "X-Microsoft-OutputFormat": "audio-16khz-128kbitrate-mono-mp3",
        },
        body: ssml,
      }
    );

    if (signal?.aborted) throw new Error("aborted");

    if (!res.ok) {
      throw new Error(`Azure TTS: HTTP ${res.status}`);
    }

    const blob = await res.blob();
    if (signal?.aborted) throw new Error("aborted");

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

  /** Play audio from a blob URL with rate control + word boundary estimation */
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
        audio.removeEventListener("timeupdate", onTimeUpdate);
        this.currentAudio = null;
      };

      const onEnd = (): void => {
        cleanup();
        callbacks.onEnd?.();
        resolve();
      };

      const onError = (): void => {
        cleanup();
        const err = audio.error?.message || "audio playback error";
        callbacks.onError?.(err);
        reject(new Error(err));
      };

      // Estimate char position from playback progress
      let lastCharIndex = -1;
      const onTimeUpdate = (): void => {
        if (audio.duration > 0) {
          const progress = audio.currentTime / audio.duration;
          // Approximate: map time progress to character progress
          const charIndex = Math.floor(progress);
          if (charIndex !== lastCharIndex) {
            lastCharIndex = charIndex;
            callbacks.onBoundary?.(charIndex, 1);
          }
        }
      };

      audio.addEventListener("ended", onEnd);
      audio.addEventListener("error", onError);
      audio.addEventListener("timeupdate", onTimeUpdate);

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

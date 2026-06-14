// ============================================================
// EdgeProvider — Edge TTS via WebSocket
// ============================================================
//
// Connects to speech.platform.bing.com via WebSocket for
// free neural TTS. Handles SSML generation, binary streaming,
// and audio blob construction.
//
// Ported from V1: shared/edge-tts-client.js + speakEdge()
//
// Note: In MV3, WebSocket connections need to be made from
// the service worker or offscreen document. This provider
// can run in either context.

import type { TtsSettings } from "@shared/types";
import type { ITtsProvider, TtsCallbacks, TtsAbortSignal } from "./ITtsProvider";
import { escapeXml } from "./ITtsProvider";

// ---- Constants ----

const EDGE_WS_URL = "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";

const EDGE_HEADERS = {
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control": "no-cache",
  "Connection": "Upgrade",
  "Pragma": "no-cache",
  "Upgrade": "websocket",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
};

// ---- Internal Types ----

interface EdgeMessage {
  type?: string;
  audio?: { data: number[] };
  error?: string;
}

// ---- Provider ----

export class EdgeProvider implements ITtsProvider {
  readonly provider = "edge" as const;

  private ws: WebSocket | null = null;
  private audioChunks: Uint8Array[] = [];
  private pendingResolve: (() => void) | null = null;
  private pendingReject: ((err: Error) => void) | null = null;
  private pendingCallbacks: TtsCallbacks | null = null;
  private pendingSignal: TtsAbortSignal | null = null;

  // ---- Public API ----

  speak(
    text: string,
    settings: TtsSettings,
    callbacks: TtsCallbacks,
    signal?: TtsAbortSignal
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      this.pendingResolve = resolve;
      this.pendingReject = reject;
      this.pendingCallbacks = callbacks;
      this.pendingSignal = signal ?? null;
      this.audioChunks = [];

      const voiceName = settings.edgeVoice || "en-US-JennyNeural";
      const rate = Number(settings.rate) || 1;
      const lang = settings.lang || "en-US";

      const ssml =
        `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" ` +
        `xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${lang}">` +
        `<voice name="${voiceName}">` +
        `<prosody rate="${rate}" pitch="+0Hz">` +
        `${escapeXml(text)}` +
        `</prosody></voice></speak>`;

      try {
        this.connectAndStream(ssml);
      } catch (err) {
        this.settle(new Error("WebSocket connection failed"));
      }

      // Abort check
      if (signal) {
        const checkAbort = setInterval(() => {
          if (signal.aborted) {
            clearInterval(checkAbort);
            this.stop();
            this.settle(new Error("aborted"));
          }
        }, 100);
      }
    });
  }

  stop(): void {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
    }
    this.ws = null;
    this.audioChunks = [];
  }

  // ---- WebSocket ----

  private connectAndStream(ssml: string): void {
    const ws = new WebSocket(EDGE_WS_URL);
    this.ws = ws;
    ws.binaryType = "arraybuffer";

    ws.onopen = (): void => {
      // Send SSML configuration message
      const configMessage = this.buildConfigMessage(ssml);
      ws.send(configMessage);
    };

    ws.onmessage = (event: MessageEvent): void => {
      if (typeof event.data === "string") {
        // Text message: JSON with metadata or end marker
        try {
          const msg = JSON.parse(event.data) as EdgeMessage | EdgeMessage[];
          const items = Array.isArray(msg) ? msg : [msg];
          for (const item of items) {
            if (item.type === "audio" && item.audio?.data) {
              this.audioChunks.push(new Uint8Array(item.audio.data));
            } else if (item.type === "error") {
              this.settle(new Error(item.error || "Edge TTS error"));
            }
          }
        } catch {
          // May be Path chunk separator — ignore
        }
      } else if (event.data instanceof ArrayBuffer) {
        // Binary message: audio data
        this.audioChunks.push(new Uint8Array(event.data));
      }
    };

    ws.onclose = (): void => {
      this.ws = null;

      // Build final audio blob
      if (this.audioChunks.length > 0) {
        const totalLength = this.audioChunks.reduce(
          (sum, chunk) => sum + chunk.length,
          0
        );
        const merged = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of this.audioChunks) {
          merged.set(chunk, offset);
          offset += chunk.length;
        }
        this.audioChunks = [];

        const blob = new Blob([merged], { type: "audio/mp3" });
        const url = URL.createObjectURL(blob);

        this.playAudio(url, Number(this.pendingSignal ?? 1))
          .then(() => {
            URL.revokeObjectURL(url);
            this.pendingCallbacks?.onEnd?.();
            this.settle();
          })
          .catch((err) => {
            URL.revokeObjectURL(url);
            this.settle(err as Error);
          });
      } else {
        // No audio — treat as end
        this.pendingCallbacks?.onEnd?.();
        this.settle();
      }
    };

    ws.onerror = (): void => {
      this.settle(new Error("Edge TTS WebSocket error"));
    };
  }

  // ---- Helpers ----

  private buildConfigMessage(ssml: string): string {
    // Build the X-RequestId (UUID-like trace ID)
    const traceId = this.generateTraceId();

    return (
      `X-RequestId:${traceId}\r\n` +
      `Content-Type:application/ssml+xml\r\n` +
      `Path:ssml\r\n\r\n` +
      `${ssml}`
    );
  }

  /** Play audio from blob URL with rate control */
  private playAudio(
    url: string,
    rate: number,
    signal?: TtsAbortSignal
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const audio = new Audio(url);
      audio.playbackRate = rate;

      const cleanup = (): void => {
        audio.removeEventListener("ended", onEnd);
        audio.removeEventListener("error", onError);
      };

      const onEnd = (): void => {
        cleanup();
        resolve();
      };

      const onError = (): void => {
        cleanup();
        reject(new Error("Edge TTS audio playback error"));
      };

      audio.addEventListener("ended", onEnd);
      audio.addEventListener("error", onError);

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

      audio.play().catch(reject);
    });
  }

  private generateTraceId(): string {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
      /[xy]/g,
      (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      }
    );
  }

  private settle(error?: Error): void {
    if (error) {
      this.pendingReject?.(error);
    } else {
      this.pendingResolve?.();
    }
    this.pendingResolve = null;
    this.pendingReject = null;
    this.pendingCallbacks = null;
  }
}

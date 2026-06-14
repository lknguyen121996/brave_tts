// ============================================================
// PlaybackController — TTS Playback Orchestrator
// ============================================================
//
// Wires together: IDocumentAdapter → ITtsProvider → Highlight
//
// The controller owns the playback lifecycle:
//   start → extract text via adapter → speak segments via provider
//   → highlight via adapter → advance to next segment → loop
//
// For Web Speech, word boundaries come from the provider's
// onBoundary callback. For Edge/Azure/Google (audio-based),
// the provider estimates character position from playback time.
//
// State is held here (not in SW — per stateless architecture).

import type { IDocumentAdapter } from "@adapters/IDocumentAdapter";
import type { ITtsProvider, TtsCallbacks } from "@content/tts/ITtsProvider";
import { WebSpeechProvider } from "@content/tts/WebSpeechProvider";
import { AzureProvider } from "@content/tts/AzureProvider";
import { GoogleProvider } from "@content/tts/GoogleProvider";
import { EdgeProvider } from "@content/tts/EdgeProvider";
import type { TtsProvider, TtsSettings, TtsEventMessage } from "@shared/types";

// ---- Provider Factory ----

export function createTtsProvider(type: TtsProvider): ITtsProvider {
  switch (type) {
    case "webspeech":
      return new WebSpeechProvider();
    case "azure":
      return new AzureProvider();
    case "google":
      return new GoogleProvider();
    case "edge":
      return new EdgeProvider();
    default:
      throw new Error(`Unknown TTS provider: ${type}`);
  }
}

// ---- Types ----

export type PlaybackState = "idle" | "reading" | "paused";

export interface PlaybackStatus {
  state: PlaybackState;
  currentIndex: number;
  totalSegments: number;
  rate: number;
}

// ---- Controller ----

export class PlaybackController {
  private adapter: IDocumentAdapter | null = null;
  private provider: ITtsProvider | null = null;
  private settings: TtsSettings | null = null;
  private segments: { id: string; text: string }[] = [];
  private currentIndex = 0;
  private state: PlaybackState = "idle";
  private abortController: AbortController | null = null;

  // ---- Public API ----

  /** Start reading with the given adapter, provider type, and settings */
  async start(
    adapter: IDocumentAdapter,
    providerType: TtsProvider,
    settings: TtsSettings
  ): Promise<void> {
    // Clean up any previous session
    this.stop();

    this.adapter = adapter;
    this.settings = settings;
    this.abortController = new AbortController();

    // Extract text from the document
    const output = adapter.extract();
    if (!output.nodes.length) {
      console.warn("[Brave Read Aloud] No readable text found");
      return;
    }

    this.segments = output.nodes.map((n) => ({ id: n.id, text: n.text }));
    this.currentIndex = 0;
    this.state = "reading";

    // Create the TTS provider
    this.provider = createTtsProvider(providerType);

    // Begin speaking loop
    await this.speakLoop();
  }

  /** Stop reading immediately */
  stop(): void {
    this.state = "idle";
    this.abortController?.abort();
    this.provider?.stop();
    this.adapter?.clearHighlight();
    this.segments = [];
    this.currentIndex = 0;
    this.provider = null;
    this.abortController = null;
  }

  /** Pause reading (stops current speech, preserves position) */
  pause(): void {
    if (this.state !== "reading") return;
    this.state = "paused";
    this.abortController?.abort();
    this.provider?.stop();
  }

  /** Resume reading from current position */
  async resume(): Promise<void> {
    if (this.state !== "paused" || !this.settings) return;
    this.state = "reading";
    this.abortController = new AbortController();

    const providerType = this.settings.provider;
    this.provider = createTtsProvider(providerType);
    await this.speakLoop();
  }

  /** Handle TTS event from service worker (for chrome.tts-based providers) */
  handleTtsEvent(event: TtsEventMessage): void {
    if (!this.adapter) return;

    switch (event.eventType) {
      case "word":
      case "sentence": {
        if (event.charIndex !== undefined) {
          const nodeId = this.findNodeIdAtChar(event.charIndex);
          if (nodeId) {
            this.adapter.highlight([nodeId]);
          }
        }
        break;
      }
      case "end": {
        // Segment complete — advance to next
        this.advanceToNext();
        break;
      }
      case "error": {
        console.error("[Brave Read Aloud] TTS error:", event.error);
        this.stop();
        break;
      }
    }
  }

  /** Get current playback status */
  getStatus(): PlaybackStatus {
    return {
      state: this.state,
      currentIndex: this.currentIndex,
      totalSegments: this.segments.length,
      rate: Number(this.settings?.rate) || 1,
    };
  }

  // ---- Private ----

  /** Speak all segments from currentIndex onward */
  private async speakLoop(): Promise<void> {
    const adapter = this.adapter;
    const provider = this.provider;
    const settings = this.settings;
    const signal = this.abortController;

    if (!adapter || !provider || !settings) return;

    try {
      for (let i = this.currentIndex; i < this.segments.length; i++) {
        if (this.state !== "reading" || signal?.signal.aborted) break;

        this.currentIndex = i;
        const seg = this.segments[i];
        if (!seg) continue;

        // Highlight current segment
        adapter.highlight([seg.id]);
        adapter.scrollToNode(seg.id);

        // Speak the segment
        const callbacks: TtsCallbacks = {
          onBoundary: (charIndex: number, _charLength: number) => {
            // charIndex from Web Speech is relative to utterance
            // For now, highlight the whole segment
          },
          onEnd: () => {
            // Auto-advanced by the loop
          },
          onError: (error: string) => {
            console.error("[Brave Read Aloud] Segment error:", error);
          },
        };

        try {
          await provider.speak(seg.text, settings, callbacks, {
            get aborted(): boolean {
              return signal?.signal.aborted ?? false;
            },
          });
        } catch (err) {
          if ((err as Error).message === "aborted") break;
          // Log and continue to next segment
          console.warn("[Brave Read Aloud] Segment failed:", err);
        }

        // Advance
        this.currentIndex = i + 1;
      }
    } finally {
      if (this.state === "reading") {
        // Finished all segments naturally
        this.state = "idle";
        adapter.clearHighlight();
      }
    }
  }

  private advanceToNext(): void {
    this.currentIndex += 1;
    if (this.currentIndex >= this.segments.length) {
      this.state = "idle";
      this.adapter?.clearHighlight();
    }
  }

  /** Find the node ID that contains the given character offset */
  private findNodeIdAtChar(charIndex: number): string | null {
    if (!this.adapter) return null;

    // Re-extract to get the lookup table
    const output = this.adapter.extract();
    const table = output.lookupTable;

    // Binary search
    let lo = 0;
    let hi = table.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const entry = table[mid];
      if (!entry) break;

      const nextEntry = table[mid + 1];
      if (
        entry.charIndex <= charIndex &&
        (!nextEntry || charIndex < nextEntry.charIndex)
      ) {
        return entry.nodeId;
      }
      if (charIndex < entry.charIndex) {
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }
    return null;
  }
}

// ============================================================
// ITtsProvider — TTS Provider Interface
// ============================================================
//
// Contract for all TTS provider implementations.
// Ported from V1's per-provider speak functions in content.js.

import type { TtsSettings } from "@shared/types";

// ---- Types ----

/** Callbacks for TTS events during speech */
export interface TtsCallbacks {
  /** Called when a word boundary is reached (for highlight tracking) */
  onBoundary?: (charIndex: number, charLength: number) => void;
  /** Called when speech completes successfully */
  onEnd?: () => void;
  /** Called when speech fails */
  onError?: (error: string) => void;
}

/** Abort signal for cancelling in-flight TTS */
export interface TtsAbortSignal {
  readonly aborted: boolean;
}

// ---- Provider Interface ----

export interface ITtsProvider {
  /** The provider identifier */
  readonly provider: "webspeech" | "edge" | "azure" | "google";

  /**
   * Speak the given text.
   * Returns when speech completes, or throws on error/abort.
   */
  speak(
    text: string,
    settings: TtsSettings,
    callbacks: TtsCallbacks,
    signal?: TtsAbortSignal
  ): Promise<void>;

  /** Stop/cancel any in-progress speech immediately */
  stop(): void;
}

// ---- Utility ----

/** Escape XML special characters for SSML */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

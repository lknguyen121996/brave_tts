// ============================================================
// Toolbar — Playback Controls
// ============================================================
//
// Floating toolbar rendered inside the Shadow DOM.
// Shows/hides based on playback state. Controls:
// - Play/Pause toggle
// - Stop
// - Rate slower/faster (±0.25x, clamped to 0.5–3.0)
// - Status label (ready / reading / paused)
//
// Behavior wiring comes in v2-09 (4 TTS Providers Port).
// For now, this is a presentational component.

import React from "react";

// ---- Types ----

export interface ToolbarProps {
  /** Current playback status */
  status: "hidden" | "ready" | "reading" | "paused";
  /** Current playback rate (0.5 – 3.0) */
  rate: number;
  /** Callback: user clicked play/pause */
  onPlayPause?: () => void;
  /** Callback: user clicked stop */
  onStop?: () => void;
  /** Callback: user clicked slower (-0.25x) */
  onSlower?: () => void;
  /** Callback: user clicked faster (+0.25x) */
  onFaster?: () => void;
}

// ---- Helpers ----

function statusLabel(status: ToolbarProps["status"]): string {
  switch (status) {
    case "reading":
      return "Đang đọc";
    case "paused":
      return "Tạm dừng";
    case "ready":
      return "Sẵn sàng";
    default:
      return "";
  }
}

// ---- Component ----

export const Toolbar: React.FC<ToolbarProps> = ({
  status,
  rate,
  onPlayPause,
  onStop,
  onSlower,
  onFaster,
}) => {
  const isHidden = status === "hidden";
  const isReading = status === "reading";
  const isPaused = status === "paused";

  return (
    <div
      className={`brave-tts-toolbar${isHidden ? " hidden" : ""}`}
      role="toolbar"
      aria-label="Brave Read Aloud controls"
    >
      {/* Play / Pause */}
      <button
        className={`brave-tts-btn${!isReading && !isPaused ? " primary" : ""}`}
        onClick={onPlayPause}
        title={isReading ? "Tạm dừng" : "Bắt đầu đọc"}
        aria-label={isReading ? "Tạm dừng" : "Bắt đầu đọc"}
      >
        {isReading ? "⏸" : "▶"}
      </button>

      {/* Stop */}
      <button
        className="brave-tts-btn"
        onClick={onStop}
        disabled={!isReading && !isPaused}
        title="Dừng"
        aria-label="Dừng"
      >
        ⏹
      </button>

      {/* Rate: Slower */}
      <button
        className="brave-tts-btn"
        onClick={onSlower}
        disabled={!isReading && !isPaused}
        title="Chậm hơn"
        aria-label="Chậm hơn"
      >
        −
      </button>

      {/* Rate label */}
      <span className="brave-tts-rate-label">{rate.toFixed(2)}×</span>

      {/* Rate: Faster */}
      <button
        className="brave-tts-btn"
        onClick={onFaster}
        disabled={!isReading && !isPaused}
        title="Nhanh hơn"
        aria-label="Nhanh hơn"
      >
        +
      </button>

      {/* Status */}
      <span
        className={`brave-tts-status ${isReading ? "reading" : ""} ${isPaused ? "paused" : ""}`}
      >
        {statusLabel(status)}
      </span>
    </div>
  );
};

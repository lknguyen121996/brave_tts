// ============================================================
// V2 Core Types — Brave Read Aloud
// ============================================================

// ---- Text Node Payload ----
// One entry per text segment extracted by an adapter.
// The full text is constructed by concatenating all payloads'
// `text` fields in `charIndex` order.

export interface TextNodePayload {
  /** Unique ID scoped to the current document (e.g. "p3-s2") */
  id: string;
  /** The text content of this segment */
  text: string;
  /** Start offset in the concatenated full text (0-based) */
  charIndex: number;
  /** Length of `text` in characters */
  charLength: number;
  /** Live DOM node reference (null for virtual adapters like Docs) */
  domNode?: Node | null;
  /** Cached bounding boxes for scroll/highlight positioning */
  rects?: DOMRect[] | null;
}

// ---- Lookup Table ----
// Sorted by `charIndex` ascending.
// Binary-searchable: given a character offset in fullText,
// find the `nodeId` that contains it in O(log n).

export interface LookupEntry {
  charIndex: number;
  nodeId: string;
}

export type LookupTable = LookupEntry[];

// ---- Adapter Output ----
// Returned by IDocumentAdapter.extractNodes()

export interface AdapterOutput {
  /** All text node payloads, sorted by charIndex */
  nodes: TextNodePayload[];
  /** Pre-built lookup table for binary search */
  lookupTable: LookupTable;
  /** Concatenated full text of the document */
  fullText: string;
}

// ---- TTS Settings ----

export type TtsProvider = "webspeech" | "edge" | "azure" | "google";

export interface TtsSettings {
  uiLang: string;
  provider: TtsProvider;
  lang: string;
  rate: number;
  voice: string;
  // Provider-specific
  azureKey: string;
  azureRegion: string;
  azureVoice: string;
  googleKey: string;
  googleVoice: string;
  edgeVoice: string;
}

export interface VoiceInfo {
  name: string;
  lang: string;
}

// ---- Playback State ----

export type PlaybackState = "idle" | "reading" | "paused";

export interface ContentScriptState {
  playbackState: PlaybackState;
  currentIndex: number;
  totalSegments: number;
  settings: TtsSettings;
  adapterType: string;
}

// ---- IPC Message Types ----
// Discriminated unions for SW ↔ CS messaging.

// --- Popup → CS (routed through SW) ---

export interface StartReadingMessage {
  type: "START_READING";
  settings: TtsSettings;
}

export interface ReadFromHereMessage {
  type: "READ_FROM_HERE";
  /** If true, read the current selection; otherwise use pointer position */
  useSelection: boolean;
  x?: number;
  y?: number;
}

export interface StopReadingMessage {
  type: "STOP_READING";
}

export interface PauseReadingMessage {
  type: "PAUSE_READING";
}

export interface ResumeReadingMessage {
  type: "RESUME_READING";
}

export interface SetRateMessage {
  type: "SET_RATE";
  rate: number;
}

export interface GetVoicesMessage {
  type: "GET_VOICES";
}

export interface GetStatusMessage {
  type: "GET_STATUS";
}

/** Messages sent TO the content script */
export type ToContentScriptMessage =
  | StartReadingMessage
  | ReadFromHereMessage
  | StopReadingMessage
  | PauseReadingMessage
  | ResumeReadingMessage
  | SetRateMessage
  | GetVoicesMessage
  | GetStatusMessage;

// --- CS → SW (TTS commands) ---

export interface TtsSpeakRequest {
  type: "TTS_SPEAK";
  /** The text chunk to speak */
  text: string;
  /** Start index in the full document text */
  startIndex: number;
  settings: TtsSettings;
}

export interface TtsStopRequest {
  type: "TTS_STOP";
}

/** When SW is killed and restarts, CS sends its state to resume */
export interface ResumePayload {
  type: "RESUME_PAYLOAD";
  fullText: string;
  currentIndex: number;
  settings: TtsSettings;
}

/** Messages sent FROM the content script */
export type FromContentScriptMessage =
  | TtsSpeakRequest
  | TtsStopRequest
  | ResumePayload;

// --- SW → CS (TTS events) ---

export type TtsEventType = "word" | "sentence" | "end" | "error" | "start";

export interface TtsEventMessage {
  type: "TTS_EVENT";
  eventType: TtsEventType;
  /** Character index in the full document text */
  charIndex?: number;
  /** Length of the spoken unit in characters */
  charLength?: number;
  /** Error message (eventType === "error") */
  error?: string;
}

/** Messages sent TO the content script from SW (event stream) */
export type ToContentScriptEvent = TtsEventMessage;

// --- CS → Popup (status updates) ---

export interface StatusResponse {
  type: "STATUS_RESPONSE";
  running: boolean;
  paused: boolean;
  total: number;
  current: number;
  rate: number;
}

export interface VoicesResponse {
  type: "VOICES_RESPONSE";
  voices: VoiceInfo[];
}

/** Messages sent TO the popup */
export type ToPopupMessage = StatusResponse | VoicesResponse;

// ---- Interception (v2-03) ----

/** Sent from content script to SW when a file:// URL is navigated to.
 * Fire-and-forget — SW may use this to trigger onboarding UI. */
export interface FileUrlDetectedMessage {
  type: "FILE_URL_DETECTED";
  url: string;
}

// ---- Generic Message Envelope ----
// Convenience union of ALL messages in the system.

export type AppMessage =
  | ToContentScriptMessage
  | FromContentScriptMessage
  | ToContentScriptEvent
  | ToPopupMessage
  | FileUrlDetectedMessage;

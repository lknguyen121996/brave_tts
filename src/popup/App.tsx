// ============================================================
// Popup App — Settings & Playback Controls
// ============================================================
//
// Ported from V1 popup.js. Manages:
// - TTS provider selection
// - Language & voice selection
// - Rate slider
// - Provider-specific API key config (Azure, Google)
// - Play/Stop buttons
// - Settings persistence via chrome.storage.sync

import React, { useState, useEffect, useCallback } from "react";
import type { TtsProvider, TtsSettings, VoiceInfo } from "@shared/types";

// ---- Constants ----

const PROVIDERS: { value: TtsProvider; label: string }[] = [
  { value: "webspeech", label: "Web Speech (miễn phí)" },
  { value: "edge", label: "Edge TTS (miễn phí)" },
  { value: "azure", label: "Azure Speech" },
  { value: "google", label: "Google Cloud TTS" },
];

const LANGUAGES: { value: string; label: string }[] = [
  { value: "", label: "— Chọn ngôn ngữ —" },
  { value: "vi-VN", label: "Tiếng Việt" },
  { value: "en-US", label: "English (US)" },
  { value: "en-GB", label: "English (UK)" },
  { value: "ja-JP", label: "日本語" },
  { value: "ko-KR", label: "한국어" },
  { value: "zh-CN", label: "中文" },
];

const RATE_MIN = 0.5;
const RATE_MAX = 3.0;
const RATE_STEP = 0.1;

const DEFAULT_SETTINGS: TtsSettings = {
  uiLang: "en",
  provider: "webspeech",
  lang: "",
  rate: 1,
  voice: "",
  azureKey: "",
  azureRegion: "southeastasia",
  azureVoice: "",
  googleKey: "",
  googleVoice: "",
  edgeVoice: "",
};

const AZURE_VOICES_FALLBACK: Record<string, string[]> = {
  "vi-VN": ["vi-VN-HoaiMyNeural", "vi-VN-NamMinhNeural"],
  "en-US": ["en-US-JennyNeural", "en-US-GuyNeural", "en-US-AriaNeural"],
  "en-GB": ["en-GB-SoniaNeural", "en-GB-RyanNeural"],
  "ja-JP": ["ja-JP-NanamiNeural", "ja-JP-KeitaNeural"],
  "ko-KR": ["ko-KR-SunHiNeural", "ko-KR-InJoonNeural"],
  "zh-CN": ["zh-CN-XiaoxiaoNeural", "zh-CN-YunxiNeural"],
};

const GOOGLE_VOICES_FALLBACK: Record<string, string[]> = {
  "vi-VN": ["vi-VN-Neural2-A", "vi-VN-Neural2-D"],
  "en-US": ["en-US-Neural2-F", "en-US-Neural2-J", "en-US-Neural2-C"],
  "en-GB": ["en-GB-Neural2-A", "en-GB-Neural2-B"],
  "ja-JP": ["ja-JP-Neural2-B", "ja-JP-Neural2-C"],
  "ko-KR": ["ko-KR-Neural2-A", "ko-KR-Neural2-C"],
  "zh-CN": ["cmn-CN-Neural2-A", "cmn-CN-Neural2-D"],
};

const EDGE_VOICES_FALLBACK: Record<string, string[]> = {
  "vi-VN": ["vi-VN-HoaiMyNeural"],
  "en-US": ["en-US-JennyNeural"],
  "en-GB": ["en-GB-SoniaNeural"],
};

const SETTINGS_FIELDS: (keyof TtsSettings)[] = [
  "uiLang", "provider", "lang", "rate", "voice",
  "azureKey", "azureRegion", "azureVoice",
  "googleKey", "googleVoice", "edgeVoice",
];

const BLOCKED_URL_PREFIXES = [
  "chrome://", "chrome-extension://", "about:",
  "edge://", "brave://",
];

// ---- Helpers ----

function isBlockedUrl(url: string): boolean {
  return BLOCKED_URL_PREFIXES.some((p) => url.startsWith(p));
}

function langPrefix(lang: string): string {
  return (lang || "").split("-")[0] ?? "";
}

function clampRate(rate: number): number {
  return Math.round(Math.min(RATE_MAX, Math.max(RATE_MIN, rate)) / RATE_STEP) * RATE_STEP;
}

// ---- Component ----

export const App: React.FC = () => {
  const [settings, setSettings] = useState<TtsSettings>(DEFAULT_SETTINGS);
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [status, setStatus] = useState("");
  const [voicesLoading, setVoicesLoading] = useState(false);

  // ---- Load settings on mount ----

  useEffect(() => {
    chrome.storage.sync.get(SETTINGS_FIELDS, (data) => {
      const merged: TtsSettings = { ...DEFAULT_SETTINGS };
      for (const key of SETTINGS_FIELDS) {
        const val = data[key];
        if (val !== undefined && val !== "") {
          (merged as unknown as Record<string, unknown>)[key] = val;
        }
      }
      if (typeof merged.rate === "string") merged.rate = Number(merged.rate) || 1;
      setSettings(merged);
    });
  }, []);

  // ---- Save settings ----

  const save = useCallback((patch: Partial<TtsSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      chrome.storage.sync.set(patch);
      return next;
    });
  }, []);

  // ---- Load voices based on provider + language ----

  const loadVoices = useCallback(async (prov: TtsProvider, lang: string) => {
    setVoicesLoading(true);
    setVoices([]);

    try {
      switch (prov) {
        case "webspeech":
          await loadWebSpeechVoices(lang);
          break;
        case "edge":
          loadFallbackVoices(EDGE_VOICES_FALLBACK, lang);
          break;
        case "azure":
          loadFallbackVoices(AZURE_VOICES_FALLBACK, lang);
          break;
        case "google":
          loadFallbackVoices(GOOGLE_VOICES_FALLBACK, lang);
          break;
      }
    } finally {
      setVoicesLoading(false);
    }
  }, []);

  // Load voices when provider or language changes
  useEffect(() => {
    if (settings.lang) {
      loadVoices(settings.provider, settings.lang);
    }
  }, [settings.provider, settings.lang, loadVoices]);

  // ---- Web Speech voices (from active tab) ----

  const loadWebSpeechVoices = async (lang: string): Promise<void> => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      setStatus("Không tìm thấy tab đang mở");
      return;
    }

    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: "GET_VOICES",
      });
      if (response?.voices) {
        const matching = filterByLang(response.voices, lang);
        setVoices(matching.length ? matching : response.voices);
      }
    } catch {
      // Content script may not be injected — try window.speechSynthesis
      setStatus("Mở một trang web trước để tải danh sách giọng");
    }
  };

  const loadFallbackVoices = (
    fallbackMap: Record<string, string[]>,
    lang: string
  ): void => {
    const prefix = langPrefix(lang);
    const exact = fallbackMap[lang] || [];
    const partial = Object.entries(fallbackMap)
      .filter(([code]) => code.startsWith(prefix))
      .flatMap(([, names]) => names);
    const all = [...new Set([...exact, ...partial])];
    setVoices(all.map((name) => ({ name, lang })));
  };

  const filterByLang = (list: VoiceInfo[], lang: string): VoiceInfo[] => {
    const prefix = langPrefix(lang);
    return list.filter(
      (v) =>
        v.lang === lang ||
        v.lang?.startsWith(prefix)
    );
  };

  // ---- Handlers ----

  const handleProviderChange = (provider: TtsProvider) => {
    save({ provider, voice: "", azureVoice: "", googleVoice: "", edgeVoice: "" });
    setStatus("");
  };

  const handleLangChange = (lang: string) => {
    save({ lang, voice: "", azureVoice: "", googleVoice: "", edgeVoice: "" });
    setStatus("");
  };

  const handleRateChange = (rate: number) => {
    save({ rate });
  };

  const handleVoiceChange = (voiceKey: string, voice: string) => {
    save({ [voiceKey]: voice } as Partial<TtsSettings>);
  };

  const handleUiLangToggle = () => {
    save({ uiLang: settings.uiLang === "vi" ? "en" : "vi" });
  };

  // ---- Play / Stop ----

  const handlePlay = async (): Promise<void> => {
    // Validate
    if (!settings.lang) {
      setStatus("Vui lòng chọn ngôn ngữ đọc");
      return;
    }

    const prov = settings.provider;
    if (prov === "webspeech" && !settings.voice) {
      setStatus("Vui lòng chọn giọng đọc");
      return;
    }
    if (prov === "azure" && !settings.azureKey) {
      setStatus("Vui lòng nhập Azure Speech key");
      return;
    }
    if (prov === "google" && !settings.googleKey) {
      setStatus("Vui lòng nhập Google Cloud API key");
      return;
    }
    if (prov === "edge" && !settings.edgeVoice) {
      setStatus("Vui lòng chọn giọng Edge");
      return;
    }

    setStatus("Đang mở...");

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      setStatus("Không tìm thấy tab đang mở");
      return;
    }
    if (tab.url && isBlockedUrl(tab.url)) {
      setStatus("Không thể đọc trang này (chrome://, about:, ...)");
      return;
    }

    try {
      await chrome.tabs.sendMessage(tab.id, {
        type: "START_READING",
        settings,
      });
      setStatus("Nhấn vào trang để bắt đầu đọc");
      setTimeout(() => window.close(), 900);
    } catch {
      // Content script may not be injected
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["src/content/index.tsx"],
        });
        await chrome.tabs.sendMessage(tab.id, {
          type: "START_READING",
          settings,
        });
        setStatus("Nhấn vào trang để bắt đầu đọc");
        setTimeout(() => window.close(), 900);
      } catch (err) {
        setStatus("Không kết nối được đến trang — thử reload trang");
        console.error("[Brave Read Aloud] Failed to start:", err);
      }
    }
  };

  const handleStop = async (): Promise<void> => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      try {
        await chrome.tabs.sendMessage(tab.id, { type: "STOP_READING" });
      } catch {
        // Content script not available
      }
    }
    setStatus("Đã dừng");
    setTimeout(() => window.close(), 500);
  };

  const handleOpenPdf = (): void => {
    const url = chrome.runtime.getURL("src/pages/pdf-viewer/index.html");
    chrome.tabs.create({ url });
    window.close();
  };

  // ---- Derived state ----

  const provider = settings.provider;
  const lang = settings.lang;
  const rate = Number(settings.rate) || 1;
  const showWebSpeechVoices = provider === "webspeech";
  const showEdgeVoices = provider === "edge";
  const showAzureConfig = provider === "azure";
  const showGoogleConfig = provider === "google";

  // ---- Render ----

  return (
    <div className="popup">
      {/* Header */}
      <header className="popup-header">
        <div className="popup-header-row">
          <h1 className="popup-title">Brave Read Aloud</h1>
          <button
            className="popup-lang-toggle"
            onClick={handleUiLangToggle}
            title={settings.uiLang === "vi" ? "Switch to English" : "Đổi sang tiếng Việt"}
          >
            {settings.uiLang === "vi" ? "EN" : "VI"}
          </button>
        </div>
        <p className="popup-subtitle">
          Đọc to, highlight &amp; tự cuộn trang
        </p>
      </header>

      {/* Action Buttons */}
      <section className="popup-actions">
        <button className="popup-btn primary" onClick={handlePlay}>
          ▶ Đọc trang
        </button>
        <button className="popup-btn danger" onClick={handleStop}>
          ■ Dừng
        </button>
        <button className="popup-btn secondary" onClick={handleOpenPdf}>
          📄 Mở PDF Reader
        </button>
      </section>

      {/* Provider Select */}
      <section className="popup-field">
        <label htmlFor="provider">Nguồn TTS</label>
        <select
          id="provider"
          value={provider}
          onChange={(e) => handleProviderChange(e.target.value as TtsProvider)}
        >
          {PROVIDERS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </section>

      {/* Language Select */}
      <section className="popup-field">
        <label htmlFor="lang">Ngôn ngữ đọc</label>
        <select
          id="lang"
          value={lang}
          onChange={(e) => handleLangChange(e.target.value)}
        >
          {LANGUAGES.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>
        <p className="popup-hint">
          Chọn ngôn ngữ trước — danh sách giọng sẽ tải theo ngôn ngữ này.
        </p>
      </section>

      {/* Rate Slider */}
      <section className="popup-field">
        <label htmlFor="rate">
          Tốc độ đọc: <span className="popup-rate-value">{rate.toFixed(1)}×</span>
        </label>
        <input
          type="range"
          id="rate"
          min={RATE_MIN}
          max={RATE_MAX}
          step={RATE_STEP}
          value={rate}
          onChange={(e) => handleRateChange(Number(e.target.value))}
        />
        <p className="popup-hint">
          Có thể chỉnh thêm bằng thanh công cụ khi đang đọc.
        </p>
      </section>

      {/* Web Speech Voice Select */}
      {showWebSpeechVoices && (
        <section className="popup-field">
          <label htmlFor="voice">Giọng đọc</label>
          <select
            id="voice"
            value={settings.voice}
            onChange={(e) => handleVoiceChange("voice", e.target.value)}
            disabled={voicesLoading}
          >
            <option value="">
              {voicesLoading ? "Đang tải..." : voices.length === 0 ? "Chọn ngôn ngữ trước" : "— Chọn giọng —"}
            </option>
            {voices.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name} ({v.lang})
              </option>
            ))}
          </select>
          <p className="popup-hint">
            Danh sách giọng lấy từ tab đang mở. Mở trang web trước nếu trống.
          </p>
        </section>
      )}

      {/* Edge Voice Select */}
      {showEdgeVoices && (
        <section className="popup-field">
          <label htmlFor="edgeVoice">Giọng đọc Edge</label>
          <select
            id="edgeVoice"
            value={settings.edgeVoice}
            onChange={(e) => handleVoiceChange("edgeVoice", e.target.value)}
          >
            <option value="">— Chọn giọng —</option>
            {voices.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name}
              </option>
            ))}
          </select>
          <p className="popup-hint">
            Giọng neural giống Microsoft Edge Read Aloud — không cần API key.
          </p>
        </section>
      )}

      {/* Azure Config */}
      {showAzureConfig && (
        <details className="popup-config" open>
          <summary>Azure Speech API</summary>
          <div className="popup-field">
            <label htmlFor="azureKey">Subscription Key</label>
            <input
              type="password"
              id="azureKey"
              value={settings.azureKey}
              onChange={(e) => save({ azureKey: e.target.value })}
              placeholder="Azure Speech key"
            />
          </div>
          <div className="popup-field">
            <label htmlFor="azureRegion">Region</label>
            <input
              type="text"
              id="azureRegion"
              value={settings.azureRegion}
              onChange={(e) => save({ azureRegion: e.target.value })}
            />
          </div>
          <div className="popup-field">
            <label htmlFor="azureVoice">Giọng đọc</label>
            <select
              id="azureVoice"
              value={settings.azureVoice}
              onChange={(e) => handleVoiceChange("azureVoice", e.target.value)}
            >
              <option value="">
                {voices.length === 0 ? "Chọn ngôn ngữ trước" : "— Chọn giọng —"}
              </option>
              {voices.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>
        </details>
      )}

      {/* Google Config */}
      {showGoogleConfig && (
        <details className="popup-config" open>
          <summary>Google Cloud TTS</summary>
          <div className="popup-field">
            <label htmlFor="googleKey">API Key</label>
            <input
              type="password"
              id="googleKey"
              value={settings.googleKey}
              onChange={(e) => save({ googleKey: e.target.value })}
              placeholder="Google Cloud API key"
            />
          </div>
          <div className="popup-field">
            <label htmlFor="googleVoice">Giọng đọc</label>
            <select
              id="googleVoice"
              value={settings.googleVoice}
              onChange={(e) => handleVoiceChange("googleVoice", e.target.value)}
            >
              <option value="">
                {voices.length === 0 ? "Chọn ngôn ngữ trước" : "— Chọn giọng —"}
              </option>
              {voices.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>
        </details>
      )}

      {/* Status */}
      {status && <p className="popup-status">{status}</p>}
    </div>
  );
};

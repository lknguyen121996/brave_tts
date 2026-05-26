const $ = (id) => document.getElementById(id);

const fields = [
  "uiLang", "provider", "lang", "rate", "voice",
  "azureKey", "azureRegion", "azureVoice",
  "googleKey", "googleVoice",
  "edgeVoice",
];

const AZURE_VOICES_FALLBACK = {
  "vi-VN": ["vi-VN-HoaiMyNeural", "vi-VN-NamMinhNeural"],
  "en-US": ["en-US-JennyNeural", "en-US-GuyNeural", "en-US-AriaNeural"],
  "en-GB": ["en-GB-SoniaNeural", "en-GB-RyanNeural"],
  "ja-JP": ["ja-JP-NanamiNeural", "ja-JP-KeitaNeural"],
  "ko-KR": ["ko-KR-SunHiNeural", "ko-KR-InJoonNeural"],
  "zh-CN": ["zh-CN-XiaoxiaoNeural", "zh-CN-YunxiNeural"],
};

const GOOGLE_VOICES_FALLBACK = {
  "vi-VN": ["vi-VN-Neural2-A", "vi-VN-Neural2-D"],
  "en-US": ["en-US-Neural2-F", "en-US-Neural2-J", "en-US-Neural2-C"],
  "en-GB": ["en-GB-Neural2-A", "en-GB-Neural2-B"],
  "ja-JP": ["ja-JP-Neural2-B", "ja-JP-Neural2-C"],
  "ko-KR": ["ko-KR-Neural2-A", "ko-KR-Neural2-C"],
  "zh-CN": ["cmn-CN-Neural2-A", "cmn-CN-Neural2-D"],
};

let cachedTabId = null;
let cachedTabUrl = null;

function getUiLang() {
  return braveTtsNormalizeUiLang($("uiLang")?.value || "vi");
}

function t(key, params) {
  return braveTtsT(key, getUiLang(), params);
}

function applyPopupI18n(uiLang = getUiLang()) {
  document.documentElement.lang = uiLang === "en" ? "en" : "vi";
  braveTtsApplyDom(document, uiLang);
}

function readSettingsFromForm() {
  const settings = {};
  for (const key of fields) {
    const el = $(key);
    if (el) settings[key] = el.type === "range" ? Number(el.value) : el.value;
  }
  if (!settings.provider) settings.provider = "webspeech";
  if (!settings.uiLang) settings.uiLang = "vi";
  return settings;
}

async function loadSettings() {
  const data = await chrome.storage.sync.get(fields);
  for (const key of fields) {
    const el = $(key);
    if (!el) continue;
    if (el.type === "range") {
      el.value = data[key] ?? 1;
      $("rateValue").textContent = Number(el.value).toFixed(1);
    } else {
      el.value = data[key] ?? el.value ?? "";
    }
  }
  applyPopupI18n(braveTtsNormalizeUiLang(data.uiLang || "vi"));
  toggleProviderSections(data.provider || "webspeech");
}

function toggleProviderSections(provider) {
  $("webspeechVoiceSection").hidden = provider !== "webspeech";
  $("edgeVoiceSection").hidden = provider !== "edge";
  $("azureSettings").hidden = provider !== "azure";
  $("googleSettings").hidden = provider !== "google";
  if (provider === "azure") $("azureSettings").open = true;
  if (provider === "google") $("googleSettings").open = true;
}

function saveSettings(settings) {
  chrome.storage.sync.set(settings);
}

function refreshActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      cachedTabId = tab?.id ?? null;
      cachedTabUrl = tab?.url ?? null;
      if (cachedTabUrl?.startsWith("file:")) {
        $("status").textContent = t("status.fileUrlAccess");
      }
      resolve({ tabId: cachedTabId, tabUrl: cachedTabUrl });
    });
  });
}

function langPrefix(lang) {
  return (lang || "").split("-")[0];
}

function voicesForLang(voices, lang) {
  const prefix = langPrefix(lang);
  if (!lang) return [];
  return voices.filter(
    (v) =>
      v.lang === lang ||
      v.Locale === lang ||
      v.lang?.startsWith(prefix) ||
      v.Locale?.startsWith(prefix) ||
      v.languageCodes?.some((lc) => lc === lang || lc.startsWith(prefix))
  );
}

function populateSelect(select, options, savedValue, emptyLabel) {
  const previous = savedValue ?? select.value;
  select.innerHTML = "";

  if (!options.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = emptyLabel || t("voice.noneForLang");
    select.appendChild(opt);
    return;
  }

  options.forEach(({ value, label }) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    select.appendChild(opt);
  });

  if (previous && [...select.options].some((opt) => opt.value === previous)) {
    select.value = previous;
  }
}

function populateVoiceSelect(voices, preferredLang) {
  const select = $("voice");
  const savedVoice = select.value;
  const lang = preferredLang || $("lang").value || "";

  if (!lang) {
    populateSelect(select, [], "", t("voice.selectLangFirst"));
    return;
  }

  const sorted = [...voices].sort(
    (a, b) => a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name)
  );
  const matching = voicesForLang(sorted, lang);
  const list = matching.length ? matching : sorted.filter((v) => v.lang);

  populateSelect(
    select,
    list.map((v) => ({ value: v.name, label: `${v.name} (${v.lang})` })),
    savedVoice,
    t("voice.noneForLang")
  );

  if (list.length === 0) {
    $("status").textContent = t("status.voicesLoadFailed");
  } else if ($("status").textContent === t("status.voicesLoadFailed")) {
    $("status").textContent = "";
  }
}

function populateFallbackVoices(select, fallbackMap, lang, savedValue) {
  const prefix = langPrefix(lang);
  const exact = fallbackMap[lang] || [];
  const partial = Object.entries(fallbackMap)
    .filter(([code]) => code.startsWith(prefix))
    .flatMap(([, names]) => names);
  const names = [...new Set([...exact, ...partial])];

  populateSelect(
    select,
    names.map((name) => ({ value: name, label: name })),
    savedValue,
    t("voice.noneDefaultForLang")
  );
}

function collectVoicesFromPage() {
  return new Promise((resolve) => {
    if (!window.speechSynthesis) {
      resolve([]);
      return;
    }

    const readVoices = () =>
      window.speechSynthesis.getVoices().map((v) => ({
        name: v.name,
        lang: v.lang,
      }));

    const initial = readVoices();
    if (initial.length) {
      resolve(initial);
      return;
    }

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.speechSynthesis.removeEventListener("voiceschanged", finish);
      resolve(readVoices());
    };

    window.speechSynthesis.addEventListener("voiceschanged", finish);
    window.speechSynthesis.getVoices();
    setTimeout(finish, 1500);
  });
}

function sendMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (resp) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(resp);
    });
  });
}

function isBlockedBrowserUrl(url) {
  return url.startsWith("chrome:") || url.startsWith("edge:") || url.startsWith("brave:");
}

async function loadWebSpeechVoices(tabId = cachedTabId, tabUrl = cachedTabUrl, lang) {
  if (!lang) {
    populateSelect($("voice"), [], "", t("voice.selectLangFirst"));
    return;
  }

  if (!tabId || !tabUrl) {
    $("status").textContent = t("status.openWebForVoices");
    return;
  }

  if (isBlockedBrowserUrl(tabUrl)) {
    $("status").textContent = t("status.openNormalWebForVoices");
    return;
  }

  try {
    let voices = [];
    try {
      const resp = await sendMessage(tabId, { type: "GET_VOICES" });
      voices = resp?.voices || [];
    } catch {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["shared/i18n.js", "content/content.js"],
      }).catch(() => {});
      const resp = await sendMessage(tabId, { type: "GET_VOICES" });
      voices = resp?.voices || [];
    }

    if (!voices.length) {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        func: collectVoicesFromPage,
      });
      voices = result?.result || [];
    }

    populateVoiceSelect(voices, lang);
  } catch (err) {
    console.error("[Brave TTS popup] loadWebSpeechVoices", err);
    $("status").textContent = t("status.voicesReloadFailed");
  }
}

async function loadAzureVoices(key, region, lang) {
  const select = $("azureVoice");
  const savedVoice = select.value;

  if (!lang) {
    populateSelect(select, [], "", t("voice.selectLangFirst"));
    return;
  }
  if (!key?.trim()) {
    populateSelect(select, [], "", t("voice.enterAzureKey"));
    return;
  }

  populateSelect(select, [], "", t("voice.loadingAzure"));

  try {
    const res = await fetch(
      `https://${region || "southeastasia"}.tts.speech.microsoft.com/cognitiveservices/voices/list`,
      { headers: { "Ocp-Apim-Subscription-Key": key.trim() } }
    );
    if (!res.ok) throw new Error(`Azure: ${res.status}`);
    const voices = await res.json();
    const matching = voicesForLang(voices, lang).sort((a, b) =>
      a.ShortName.localeCompare(b.ShortName)
    );

    if (!matching.length) {
      populateFallbackVoices(select, AZURE_VOICES_FALLBACK, lang, savedVoice);
      $("status").textContent = t("status.azureNoVoices");
      return;
    }

    populateSelect(
      select,
      matching.map((v) => ({
        value: v.ShortName,
        label: `${v.ShortName} (${v.Locale})`,
      })),
      savedVoice
    );
    if ($("status").textContent === t("status.azureNoVoices")) $("status").textContent = "";
  } catch (err) {
    console.error("[Brave TTS popup] loadAzureVoices", err);
    populateFallbackVoices(select, AZURE_VOICES_FALLBACK, lang, savedVoice);
    $("status").textContent = t("status.azureApiFailed");
  }
}

async function loadGoogleVoices(key, lang) {
  const select = $("googleVoice");
  const savedVoice = select.value;

  if (!lang) {
    populateSelect(select, [], "", t("voice.selectLangFirst"));
    return;
  }
  if (!key?.trim()) {
    populateSelect(select, [], "", t("voice.enterGoogleKey"));
    return;
  }

  populateSelect(select, [], "", t("voice.loadingGoogle"));

  try {
    const res = await fetch(
      `https://texttospeech.googleapis.com/v1/voices?key=${encodeURIComponent(key.trim())}`
    );
    if (!res.ok) throw new Error(`Google: ${res.status}`);
    const data = await res.json();
    const matching = voicesForLang(data.voices || [], lang).sort((a, b) =>
      a.name.localeCompare(b.name)
    );

    if (!matching.length) {
      populateFallbackVoices(select, GOOGLE_VOICES_FALLBACK, lang, savedVoice);
      $("status").textContent = t("status.googleNoVoices");
      return;
    }

    populateSelect(
      select,
      matching.map((v) => ({
        value: v.name,
        label: `${v.name} (${v.languageCodes?.[0] || lang})`,
      })),
      savedVoice
    );
    if ($("status").textContent === t("status.googleNoVoices")) $("status").textContent = "";
  } catch (err) {
    console.error("[Brave TTS popup] loadGoogleVoices", err);
    populateFallbackVoices(select, GOOGLE_VOICES_FALLBACK, lang, savedVoice);
    $("status").textContent = t("status.googleApiFailed");
  }
}

async function loadEdgeVoices(lang) {
  const select = $("edgeVoice");
  const savedVoice = select.value;

  if (!lang) {
    populateSelect(select, [], "", t("voice.selectLangFirst"));
    return;
  }

  populateFallbackVoices(select, AZURE_VOICES_FALLBACK, lang, savedVoice);
  $("status").textContent = t("voice.loadingEdge");

  if (typeof EdgeTtsClient === "undefined") {
    $("status").textContent = t("status.edgeApiFailed");
    return;
  }

  try {
    const voices = await EdgeTtsClient.listVoices();
    const matching = voicesForLang(voices || [], lang).sort((a, b) =>
      a.ShortName.localeCompare(b.ShortName)
    );

    if (!matching.length) {
      $("status").textContent = t("status.edgeNoVoices");
      return;
    }

    populateSelect(
      select,
      matching.map((v) => ({
        value: v.ShortName,
        label: `${v.ShortName} (${v.Locale})`,
      })),
      savedVoice
    );
    $("status").textContent = "";
  } catch (err) {
    console.error("[Brave TTS popup] loadEdgeVoices", err);
    populateFallbackVoices(select, AZURE_VOICES_FALLBACK, lang, savedVoice);
    $("status").textContent = t("status.edgeApiFailed");
  }
}

async function refreshVoicesForProvider() {
  const settings = readSettingsFromForm();
  const { provider, lang, azureKey, azureRegion, googleKey } = settings;

  if (!lang) {
    if (provider === "webspeech") {
      populateSelect($("voice"), [], "", t("voice.selectLangFirst"));
    } else if (provider === "edge") {
      populateSelect($("edgeVoice"), [], "", t("voice.selectLangFirst"));
    } else if (provider === "azure") {
      populateSelect($("azureVoice"), [], "", t("voice.selectLangFirst"));
    } else if (provider === "google") {
      populateSelect($("googleVoice"), [], "", t("voice.selectLangFirst"));
    }
    return;
  }

  if (provider === "webspeech") {
    const { tabId, tabUrl } = await refreshActiveTab();
    await loadWebSpeechVoices(tabId, tabUrl, lang);
  } else if (provider === "edge") {
    await loadEdgeVoices(lang);
  } else if (provider === "azure") {
    await loadAzureVoices(azureKey, azureRegion, lang);
  } else if (provider === "google") {
    await loadGoogleVoices(googleKey, lang);
  }
}

function validateSettings(settings) {
  if (!settings.lang) {
    return t("status.selectReadLang");
  }
  if (settings.provider === "azure") {
    if (!settings.azureKey?.trim()) return t("status.enterAzureKey");
    if (!settings.azureVoice) return t("status.selectAzureVoice");
  }
  if (settings.provider === "google") {
    if (!settings.googleKey?.trim()) return t("status.enterGoogleKey");
    if (!settings.googleVoice) return t("status.selectGoogleVoice");
  }
  if (settings.provider === "edge") {
    if (!settings.edgeVoice) return t("status.selectEdgeVoice");
  }
  return "";
}

function injectAndStart(tabId, settings) {
  return chrome.scripting.executeScript({
    target: { tabId },
    files: ["shared/i18n.js", "content/content.js"],
  }).then(() =>
    chrome.scripting.insertCSS({
      target: { tabId },
      files: ["content/content.css"],
    })
  ).then(() =>
    chrome.tabs.sendMessage(tabId, { type: "START_READING", settings })
  );
}

function startOnTab(tabId, settings) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { type: "START_READING", settings }, (resp) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(resp);
    });
  });
}

$("rate").addEventListener("input", (e) => {
  $("rateValue").textContent = Number(e.target.value).toFixed(1);
});

$("rate").addEventListener("change", () => {
  saveSettings(readSettingsFromForm());
});

$("uiLang").addEventListener("change", () => {
  const settings = readSettingsFromForm();
  applyPopupI18n(settings.uiLang);
  saveSettings(settings);
  refreshVoicesForProvider();
});

$("provider").addEventListener("change", (e) => {
  toggleProviderSections(e.target.value);
  saveSettings(readSettingsFromForm());
  refreshVoicesForProvider();
});

$("lang").addEventListener("change", () => {
  saveSettings(readSettingsFromForm());
  refreshVoicesForProvider();
});

$("azureKey").addEventListener("change", () => {
  saveSettings(readSettingsFromForm());
  if ($("provider").value === "azure") refreshVoicesForProvider();
});

$("azureRegion").addEventListener("change", () => {
  saveSettings(readSettingsFromForm());
  if ($("provider").value === "azure" && $("azureKey").value.trim()) {
    refreshVoicesForProvider();
  }
});

$("googleKey").addEventListener("change", () => {
  saveSettings(readSettingsFromForm());
  if ($("provider").value === "google") refreshVoicesForProvider();
});

fields.forEach((key) => {
  const el = $(key);
  if (el && !["provider", "rate", "lang", "uiLang", "azureKey", "azureRegion", "googleKey"].includes(key)) {
    el.addEventListener("change", () => saveSettings(readSettingsFromForm()));
  }
});

$("btnPlay").addEventListener("click", () => {
  const settings = readSettingsFromForm();
  const validationError = validateSettings(settings);
  if (validationError) {
    $("status").textContent = validationError;
    return;
  }

  saveSettings(settings);

  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    const tabId = tab?.id;
    const tabUrl = tab?.url || "";

    if (!tabId) {
      $("status").textContent = t("status.noActiveTab");
      return;
    }

    if (isBlockedBrowserUrl(tabUrl)) {
      $("status").textContent = t("status.blockedBrowserUrl");
      return;
    }

    $("status").textContent = t("status.openingPrompt");

    startOnTab(tabId, settings)
      .then(() => {
        $("status").textContent = t("status.clickStartOnPage");
        setTimeout(() => window.close(), 900);
      })
      .catch(() =>
        injectAndStart(tabId, settings)
          .then(() => {
            $("status").textContent = t("status.clickStartOnPage");
            setTimeout(() => window.close(), 900);
          })
          .catch((err) => {
            $("status").textContent = t("status.connectFailed");
            console.error("[Brave TTS popup]", err);
          })
      );
  });
});

$("btnStop").addEventListener("click", () => {
  if (!cachedTabId) return;
  chrome.tabs.sendMessage(cachedTabId, { type: "STOP_READING" }, () => {
    $("status").textContent = chrome.runtime.lastError
      ? t("status.tabConnectFailed")
      : t("status.stopped");
  });
});

loadSettings().then(async () => {
  await refreshActiveTab();
  await refreshVoicesForProvider();
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && $("provider").value === "webspeech" && $("lang").value) {
    refreshActiveTab().then(() => refreshVoicesForProvider());
  }
});

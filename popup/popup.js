const $ = (id) => document.getElementById(id);

const fields = [
  "provider", "lang", "rate", "voice",
  "azureKey", "azureRegion", "azureVoice",
  "googleKey", "googleVoice",
];

let cachedTabId = null;
let cachedTabUrl = null;

function readSettingsFromForm() {
  const settings = {};
  for (const key of fields) {
    const el = $(key);
    if (el) settings[key] = el.type === "range" ? Number(el.value) : el.value;
  }
  if (!settings.provider) settings.provider = "webspeech";
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
  toggleProviderSections(data.provider || "webspeech");
}

function toggleProviderSections(provider) {
  $("azureSettings").open = provider === "azure";
  $("googleSettings").open = provider === "google";
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
        $("status").textContent =
          "Trang file:// cần bật 'Allow access to file URLs' tại brave://extensions.";
      }
      resolve({ tabId: cachedTabId, tabUrl: cachedTabUrl });
    });
  });
}

function populateVoiceSelect(voices, preferredLang) {
  const select = $("voice");
  const savedVoice = select.value;
  const lang = preferredLang || $("lang").value || "";
  const langPrefix = lang.split("-")[0];

  select.innerHTML = '<option value="">Mặc định hệ thống</option>';

  const sorted = [...voices].sort(
    (a, b) => a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name)
  );
  const matching = sorted.filter(
    (v) => !lang || v.lang.startsWith(lang) || v.lang.startsWith(langPrefix)
  );
  const list = matching.length ? matching : sorted;

  list.forEach((v) => {
    const opt = document.createElement("option");
    opt.value = v.name;
    opt.textContent = `${v.name} (${v.lang})`;
    select.appendChild(opt);
  });

  if (savedVoice && [...select.options].some((opt) => opt.value === savedVoice)) {
    select.value = savedVoice;
  }

  if (list.length === 0) {
    $("status").textContent = "Không tải được danh sách giọng. Mở trang web thường rồi mở lại popup.";
  } else if ($("status").textContent.includes("Không tải được danh sách giọng")) {
    $("status").textContent = "";
  }
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

async function loadVoices(tabId = cachedTabId, tabUrl = cachedTabUrl) {
  if (!tabId || !tabUrl) return;

  if (isBlockedBrowserUrl(tabUrl)) {
    $("status").textContent = "Mở trang web thường để tải danh sách giọng Web Speech.";
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
        files: ["content/content.js"],
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

    populateVoiceSelect(voices, $("lang").value);
  } catch (err) {
    console.error("[Brave TTS popup] loadVoices", err);
    $("status").textContent =
      "Không tải được giọng đọc. Reload trang web rồi mở lại popup.";
  }
}

function isBlockedBrowserUrl(url) {
  return url.startsWith("chrome:") || url.startsWith("edge:") || url.startsWith("brave:");
}

function injectAndStart(tabId, settings) {
  return chrome.scripting.executeScript({
    target: { tabId },
    files: ["content/content.js"],
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

$("provider").addEventListener("change", (e) => {
  toggleProviderSections(e.target.value);
  saveSettings(readSettingsFromForm());
  if (e.target.value === "webspeech") {
    refreshActiveTab().then(({ tabId, tabUrl }) => loadVoices(tabId, tabUrl));
  }
});

$("lang").addEventListener("change", () => {
  saveSettings(readSettingsFromForm());
  refreshActiveTab().then(({ tabId, tabUrl }) => loadVoices(tabId, tabUrl));
});

fields.forEach((key) => {
  const el = $(key);
  if (el && key !== "provider" && key !== "rate") {
    el.addEventListener("change", () => saveSettings(readSettingsFromForm()));
  }
});

$("btnPlay").addEventListener("click", () => {
  const settings = readSettingsFromForm();
  saveSettings(settings);

  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    const tabId = tab?.id;
    const tabUrl = tab?.url || "";

    if (!tabId) {
      $("status").textContent = "Không có tab active. Mở trang web rồi thử lại.";
      return;
    }

    if (isBlockedBrowserUrl(tabUrl)) {
      $("status").textContent = "Không đọc được trang nội bộ trình duyệt (brave://, chrome://).";
      return;
    }

    $("status").textContent = "Đang mở hộp bắt đầu trên trang...";

    startOnTab(tabId, settings)
      .then(() => {
        $("status").textContent = "Bấm 'Bắt đầu đọc' trên trang web.";
        setTimeout(() => window.close(), 900);
      })
      .catch(() =>
        injectAndStart(tabId, settings)
          .then(() => {
            $("status").textContent = "Bấm 'Bắt đầu đọc' trên trang web.";
            setTimeout(() => window.close(), 900);
          })
          .catch((err) => {
            $("status").textContent =
              "Lỗi: không kết nối được trang. Thử reload trang hoặc bật quyền file URL tại brave://extensions.";
            console.error("[Brave TTS popup]", err);
          })
      );
  });
});

$("btnStop").addEventListener("click", () => {
  if (!cachedTabId) return;
  chrome.tabs.sendMessage(cachedTabId, { type: "STOP_READING" }, () => {
    $("status").textContent = chrome.runtime.lastError
      ? "Không thể kết nối tab."
      : "Đã dừng.";
  });
});

loadSettings().then(async () => {
  const { tabId, tabUrl } = await refreshActiveTab();
  await loadVoices(tabId, tabUrl);
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    refreshActiveTab().then(({ tabId, tabUrl }) => loadVoices(tabId, tabUrl));
  }
});

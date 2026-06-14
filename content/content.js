(() => {
  if (window.__braveTtsLoaded) return;
  window.__braveTtsLoaded = true;

  const STATE = {
    running: false,
    paused: false,
    segments: [],
    currentIndex: 0,
    settings: {},
    highlightEl: null,
    toolbar: null,
    abortController: null,
    currentAudio: null,
    speakToken: 0,
    lastPointer: null,
    readGeneration: 0,
    playRequestId: 0,
    hoverTarget: null,
    hoverTimer: null,
    hoverPlayBtn: null,
    autoFollow: true,
    backOnTrackEl: null,
    gesturePromptEl: null,
    currentReadRange: null,
    programmaticScroll: false,
    scrollListenerAttached: false,
    lastProgrammaticScrollAt: 0,
    docsFullText: "",
    docsEntries: [],
    docsPlainMode: false,
    docsA11yMode: false,
    docsClosureMode: false,
    docsA11yStyleNode: null,
    docsA11yPollDone: false,
    docsScreenReaderTried: false,
    edgeAudioCache: new Map(),
    nextAudioUrl: null,
    playbackAudio: null,
  };

  const docsHooks = { active: false };

  const PARAGRAPH_SELECTOR = "p, li, blockquote, h1, h2, h3, h4, h5, h6, td, pre";

  const SETTINGS_FIELDS = [
    "uiLang", "provider", "lang", "rate", "voice",
    "azureKey", "azureRegion", "azureVoice",
    "googleKey", "googleVoice",
    "edgeVoice",
  ];

  const PLAYBACK_PROFILE_KEYS = [
    "provider", "lang", "voice", "edgeVoice", "azureVoice", "googleVoice",
    "azureKey", "azureRegion", "googleKey",
  ];

  function uiLang() {
    return braveTtsNormalizeUiLang(STATE.settings?.uiLang);
  }

  function t(key, params) {
    return braveTtsT(key, uiLang(), params);
  }

  function syncContentUi() {
    if (STATE.toolbar) {
      const bar = STATE.toolbar;
      const statusEl = bar.querySelector(".status");
      const currentStatus = statusEl?.dataset.status || "";
      const rateLabel = bar.querySelector(".rate-label");
      const slowerBtn = bar.querySelector('[data-action="slower"]');
      const fasterBtn = bar.querySelector('[data-action="faster"]');
      const stopBtn = bar.querySelector('[data-action="stop"]');
      if (rateLabel) {
        rateLabel.textContent = t("content.toolbarRate");
        rateLabel.title = t("content.toolbarRate");
      }
      if (slowerBtn) slowerBtn.title = t("content.toolbarSlower");
      if (fasterBtn) fasterBtn.title = t("content.toolbarFaster");
      if (stopBtn) stopBtn.textContent = t("content.toolbarStop");
      updatePauseButton();
      if (currentStatus === "reading") {
        setStatus(t("content.statusReading"), "reading");
      } else if (currentStatus === "paused") {
        setStatus(t("content.statusPaused"), "paused");
      } else if (currentStatus === "ready") {
        setStatus(t("content.toolbarReady"), "ready");
      }
    }

    if (STATE.backOnTrackEl) {
      STATE.backOnTrackEl.textContent = t("content.backOnTrack");
      STATE.backOnTrackEl.title = t("content.backOnTrackTitle");
    }

    if (STATE.hoverPlayBtn) {
      STATE.hoverPlayBtn.title = t("content.readFromHere");
      STATE.hoverPlayBtn.setAttribute("aria-label", t("content.readFromHere"));
    }

  }

  const MIN_RATE = 0.5;
  const MAX_RATE = 3;
  const HOVER_PLAY_DELAY_MS = 500;
  const EDGE_PREFETCH_AHEAD = 5;
  const EDGE_AUDIO_CACHE_MAX = 24;
  const EDGE_HOVER_PREFETCH_AHEAD = 2;

  function revokeNextAudioUrl() {
    if (STATE.nextAudioUrl) {
      URL.revokeObjectURL(STATE.nextAudioUrl);
      STATE.nextAudioUrl = null;
    }
  }

  function setNextAudioUrl(bytes) {
    revokeNextAudioUrl();
    STATE.nextAudioUrl = URL.createObjectURL(new Blob([bytes], { type: "audio/mp3" }));
  }

  function takeNextAudioUrl() {
    const url = STATE.nextAudioUrl;
    STATE.nextAudioUrl = null;
    return url;
  }

  function prepareNextEdgeAudioUrl(settings, token) {
    if (settings?.provider !== "edge") return;
    const nextText = STATE.segments[STATE.currentIndex + 1]?.text;
    if (!nextText) return;

    const key = edgeAudioCacheKey(nextText, settings);
    const cached = STATE.edgeAudioCache.get(key);
    if (cached instanceof Uint8Array && cached.length) {
      if (token === STATE.speakToken) setNextAudioUrl(cached);
      return;
    }

    getEdgeAudioBytes(nextText, settings, { priority: false })
      .then((bytes) => {
        if (token === STATE.speakToken && bytes?.length) setNextAudioUrl(bytes);
      })
      .catch(() => {});
  }

  function clampRate(rate) {
    return Math.min(MAX_RATE, Math.max(MIN_RATE, Number(rate) || 1));
  }

  const SKIP_TAGS = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "SVG", "CANVAS", "IFRAME",
    "OBJECT", "EMBED", "VIDEO", "AUDIO", "INPUT", "TEXTAREA", "SELECT", "BUTTON",
  ]);

  function isVisible(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isGoogleDocs() {
    return docsHooks.active;
  }

  function getReadableRoot() {
    if (docsHooks.getReadableRoot) {
      const docsRoot = docsHooks.getReadableRoot();
      if (docsRoot) return docsRoot;
    }

    const selectors = [
      "[data-testid='content']",
      ".rich-lfc-content",
      "[itemprop='articleBody']",
      ".post-content",
      ".article-body",
      ".article-content",
      ".entry-content",
      "#content",
      "article",
      "main",
      "[role='main']",
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && isVisible(el) && el.innerText.trim().length > 30) return el;
    }
    return document.body;
  }

  function isExcludedParagraph(el) {
    if (!el) return true;
    if (el.closest(
      "nav, header, footer, aside, [role='navigation'], [role='banner'], [role='contentinfo'], " +
      "[data-testid*='nav'], [data-testid*='feed-card'], [data-testid*='menu'], " +
      ".brave-tts-toolbar, .brave-tts-play-here"
    )) {
      return true;
    }
    if (el.closest("a, button")) return true;
    return false;
  }

  function collectTextNodes(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
        const inDocsEditor = docsHooks.isInDocsEditor?.(parent);
        if (!inDocsEditor && !isVisible(parent)) return NodeFilter.FILTER_REJECT;
        const text = node.textContent.replace(/\s+/g, " ").trim();
        if (!text || text.length < 2) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    return nodes;
  }

  function splitIntoSegments(textNodes) {
    const segments = [];
    for (const node of textNodes) {
      const raw = node.textContent;
      const parts = raw.match(/[^.!?。！？]+[.!?。！？]?/g) || [raw.trim()];
      let searchFrom = 0;
      for (const part of parts) {
        const text = part.trim();
        if (text.length < 2) continue;
        const idx = raw.indexOf(part, searchFrom);
        if (idx === -1) continue;
        segments.push({
          text,
          node,
          element: node.parentElement,
          startInNode: idx,
          endInNode: idx + part.length,
        });
        searchFrom = idx + part.length;
      }
    }
    return segments;
  }

  function isSkippableTarget(el) {
    return !el || el.closest(".brave-tts-toolbar, .brave-tts-play-here, .brave-tts-hover-play, .brave-tts-back-on-track, .brave-tts-gesture-prompt");
  }

  function supportsCssHighlights() {
    try {
      return typeof CSS !== "undefined" && CSS.highlights && typeof Highlight !== "undefined";
    } catch {
      return false;
    }
  }

  function safeSetHighlight(name, range) {
    if (!supportsCssHighlights() || !range) return false;
    try {
      CSS.highlights.set(name, new Highlight(range));
      return true;
    } catch {
      return false;
    }
  }

  function safeDeleteHighlight(name) {
    if (!supportsCssHighlights()) return;
    try {
      CSS.highlights.delete(name);
    } catch {
      /* ignore */
    }
  }

  function resolveReadStartFromElement(el) {
    if (!el || !STATE.segments.length) return null;

    if (docsHooks.resolveReadStartFromElement) {
      const docsResult = docsHooks.resolveReadStartFromElement(el);
      if (docsResult) return docsResult;
    }

    for (let i = 0; i < STATE.segments.length; i++) {
      const seg = STATE.segments[i];
      if (!seg.element) continue;
      if (el === seg.element || el.contains(seg.element) || seg.element.contains(el)) {
        return { index: i, textOverride: null };
      }
    }

    for (let i = 0; i < STATE.segments.length; i++) {
      const seg = STATE.segments[i];
      if (seg.node && el.contains(seg.node)) {
        return { index: i, textOverride: null };
      }
    }

    return null;
  }

  function findBlockFromTarget(target) {
    if (docsHooks.findBlockFromTarget) {
      const result = docsHooks.findBlockFromTarget(target);
      if (result) return result;
    }
    return target?.closest?.(PARAGRAPH_SELECTOR) ||
      target?.closest?.("article, main, section, div[data-brave-tts-block]");
  }

  function getHoverReadingTarget(x, y) {
    if (docsHooks.getHoverReadingTarget) {
      return docsHooks.getHoverReadingTarget(x, y);
    }

    const el = document.elementFromPoint(x, y);
    if (!el || isSkippableTarget(el)) return null;

    const root = getReadableRoot();
    const block = el.closest(PARAGRAPH_SELECTOR);
    if (!block || !root.contains(block) || isExcludedParagraph(block)) return null;
    if (block.textContent.replace(/\s+/g, " ").trim().length < 8) return null;
    return block;
  }

  function clearHoverPlayTimer() {
    if (STATE.hoverTimer) {
      clearTimeout(STATE.hoverTimer);
      STATE.hoverTimer = null;
    }
  }

  function hideHoverPlayButton() {
    STATE.hoverPlayBtn?.remove();
    STATE.hoverPlayBtn = null;
    document.querySelectorAll(".brave-tts-line-hover").forEach((el) => {
      el.classList.remove("brave-tts-line-hover");
    });
  }

  function showHoverPlayButton(target) {
    hideHoverPlayButton();
    if (!target) return;

    target.classList.add("brave-tts-line-hover");
    const rect = target.getBoundingClientRect();
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "brave-tts-hover-play";
    btn.title = t("content.readFromHere");
    btn.setAttribute("aria-label", t("content.readFromHere"));
    btn.textContent = STATE.running ? "↪" : "▶";
    btn.style.left = `${Math.max(8, rect.left - 34)}px`;
    btn.style.top = `${Math.max(8, rect.top + rect.height / 2 - 14)}px`;

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      hideHoverPlayButton();
      startReadingFromTarget(target, null);
    }, true);

    btn.addEventListener("pointerdown", (e) => e.stopPropagation(), true);
    document.body.appendChild(btn);
    STATE.hoverPlayBtn = btn;
  }

  async function startReadingFromTarget(target, point) {
    if (!target) return;

    if (docsHooks.startReadingFromTarget) {
      return docsHooks.startReadingFromTarget(target, point);
    }

    if (!buildSegments()) {
      alert(t("content.noText"));
      return;
    }
    const startInfo = resolveReadStartFromElement(target);
    if (!startInfo) {
      alert(t("content.noReadPosition"));
      return;
    }
    if (STATE.running) {
      jumpToStartInfo(startInfo);
      return;
    }
    requestReading(startInfo, null, target);
  }

  // Debounce: mousemove + pointermove fire together per physical move.
  // Batch to one process per animation frame using the latest event.
  let _hoverThrottle = null;
  let _latestHoverEvent = null;

  function onHoverPointerMove(e) {
    if (e.target?.closest?.(".brave-tts-hover-play")) return;
    _latestHoverEvent = e;
    if (_hoverThrottle) return;
    _hoverThrottle = requestAnimationFrame(() => {
      _hoverThrottle = null;
      const ev = _latestHoverEvent;
      _latestHoverEvent = null;
      if (ev) processHoverPointerMove(ev);
    });
  }

  function processHoverPointerMove(e) {
    const target = getHoverReadingTarget(e.clientX, e.clientY);
    if (!target) {
      if (STATE.hoverTimer || STATE.hoverPlayBtn) return;
      STATE.hoverTarget = null;
      clearHoverPlayTimer();
      hideHoverPlayButton();
      return;
    }

    if (target === STATE.hoverTarget && (STATE.hoverPlayBtn || STATE.hoverTimer)) return;

    const sameBlock = target === STATE.hoverTarget;
    STATE.hoverTarget = target;
    if (sameBlock && STATE.hoverPlayBtn) return;

    clearHoverPlayTimer();
    hideHoverPlayButton();

    STATE.hoverTimer = setTimeout(() => {
      if (STATE.hoverTarget !== target || !target.isConnected) return;
      showHoverPlayButton(target);
      maybePrefetchEdgeOnHover(target);
    }, HOVER_PLAY_DELAY_MS);
  }

  function onHoverPointerLeave() {
    STATE.hoverTarget = null;
    clearHoverPlayTimer();
    hideHoverPlayButton();
  }

  function getCaretFromPoint(x, y) {
    let range = null;
    if (document.caretRangeFromPoint) {
      range = document.caretRangeFromPoint(x, y);
    } else if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(x, y);
      if (pos) {
        range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
        range.collapse(true);
      }
    }
    if (!range) return null;
    return { node: range.startContainer, offset: range.startOffset };
  }

  function normalizeTextNode(node, offset) {
    if (!node) return null;
    if (node.nodeType === Node.TEXT_NODE) {
      return { node, offset: Math.max(0, Math.min(offset, node.textContent.length)) };
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const child = node.childNodes[offset] || node.childNodes[Math.max(0, offset - 1)];
      if (child) {
        if (child.nodeType === Node.TEXT_NODE) {
          return { node: child, offset: 0 };
        }
        const walker = document.createTreeWalker(child, NodeFilter.SHOW_TEXT);
        const first = walker.nextNode();
        if (first) return { node: first, offset: 0 };
      }
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      const first = walker.nextNode();
      if (first) return { node: first, offset: 0 };
    }
    return null;
  }

  function trimFromWordBoundary(text) {
    const trimmed = text.replace(/^\s+/, "");
    if (!trimmed) return "";
    const wordStart = trimmed.search(/\S/);
    return wordStart >= 0 ? trimmed.slice(wordStart) : trimmed;
  }

  function resolveReadStart(node, offset) {
    const caret = normalizeTextNode(node, offset);
    if (!caret) return null;

    const { node: textNode, offset: nodeOffset } = caret;
    if (textNode.parentElement && SKIP_TAGS.has(textNode.parentElement.tagName)) return null;

    for (let i = 0; i < STATE.segments.length; i++) {
      const seg = STATE.segments[i];
      if (seg.node !== textNode) {
        if (!seg.element?.contains(textNode)) continue;
        return { index: i, textOverride: null };
      }

      if (nodeOffset >= seg.endInNode) continue;
      if (nodeOffset <= seg.startInNode) {
        return { index: i, textOverride: null };
      }

      const slice = textNode.textContent.slice(nodeOffset, seg.endInNode);
      const textOverride = trimFromWordBoundary(slice);
      if (!textOverride) {
        return { index: Math.min(i + 1, STATE.segments.length - 1), textOverride: null };
      }
      return { index: i, textOverride };
    }

    return null;
  }

  function resolveReadStartFromPoint(x, y) {
    if (docsHooks.resolveReadStartFromPoint) {
      return docsHooks.resolveReadStartFromPoint(x, y);
    }
    const caret = getCaretFromPoint(x, y);
    if (!caret) return null;
    return resolveReadStart(caret.node, caret.offset);
  }

  function resolveReadStartFromSelection() {
    if (docsHooks.resolveReadStartFromSelection) {
      return docsHooks.resolveReadStartFromSelection();
    }
    const sel = window.getSelection();
    if (!sel?.rangeCount) return null;
    const range = sel.getRangeAt(0);
    return resolveReadStart(range.startContainer, range.startOffset);
  }

  function isExtensionAlive() {
    return typeof chrome !== "undefined" && chrome.runtime?.id;
  }

  function safeStorageGet(keys) {
    if (!isExtensionAlive()) return Promise.resolve({});
    return new Promise((resolve) => {
      try {
        chrome.storage.sync.get(keys, (data) => {
          const err = chrome.runtime.lastError;
          if (err || !isExtensionAlive()) { resolve({}); return; }
          resolve(data || {});
        });
      } catch (_) {
        resolve({});
      }
    });
  }

  function loadStoredSettings() {
    return safeStorageGet(SETTINGS_FIELDS).then((data) => ({
      ...data,
      rate: clampRate(data.rate || 1),
    }));
  }

  function ensureVoices() {
    return new Promise((resolve) => {
      if (!window.speechSynthesis) {
        resolve([]);
        return;
      }

      const voices = window.speechSynthesis.getVoices();
      if (voices.length) {
        resolve(voices);
        return;
      }

      let voiceTimer;
      const done = () => {
        clearTimeout(voiceTimer);
        window.speechSynthesis.onvoiceschanged = null;
        resolve(window.speechSynthesis.getVoices());
      };

      window.speechSynthesis.onvoiceschanged = done;
      voiceTimer = setTimeout(done, 800);
    });
  }

  function prepareSpeechEngine() {
    if (!window.speechSynthesis) return;
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    }
  }

  function hideGesturePrompt() {
    STATE.gesturePromptEl?.remove();
    STATE.gesturePromptEl = null;
  }

  function showGesturePrompt(settings, startInfo = { index: 0, textOverride: null }, blockEl = null) {
    hideGesturePrompt();
    if (settings?.uiLang) {
      STATE.settings = { ...STATE.settings, uiLang: settings.uiLang };
    }
    if (!buildSegments()) {
      alert(t("content.noText"));
      return;
    }

    const overlay = document.createElement("div");
    overlay.className = "brave-tts-gesture-prompt";
    overlay.innerHTML = `
      <div class="brave-tts-gesture-card">
        <p class="title">Brave Read Aloud</p>
        <p class="desc">${t("content.gestureDesc")}</p>
        <button type="button" class="brave-tts-gesture-start">${t("content.gestureStart")}</button>
        <button type="button" class="brave-tts-gesture-cancel">${t("content.gestureCancel")}</button>
      </div>
    `;

    overlay.querySelector(".brave-tts-gesture-start").addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      hideGesturePrompt();
      requestReading(startInfo, settings, blockEl);
    });

    overlay.querySelector(".brave-tts-gesture-cancel").addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      hideGesturePrompt();
    });

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) hideGesturePrompt();
    });

    document.body.appendChild(overlay);
    STATE.gesturePromptEl = overlay;
  }

  function buildSegments() {
    if (docsHooks.buildSegments) return docsHooks.buildSegments();

    const root = getReadableRoot();
    const textNodes = collectTextNodes(root);
    STATE.segments = splitIntoSegments(textNodes);
    return STATE.segments.length > 0;
  }

  function maybeExtendSegments(currentIndex) {
    docsHooks.maybeExtendSegments?.(currentIndex);
  }

  function cancelCurrentSpeech() {
    STATE.speakToken += 1;
    window.speechSynthesis?.cancel();
    if (STATE.currentAudio) {
      STATE.currentAudio.pause();
      STATE.currentAudio = null;
    }
    revokeNextAudioUrl();
  }

  function abortReadingSession() {
    STATE.readGeneration += 1;
    STATE.edgeAudioCache.clear();
    revokeNextAudioUrl();
    cancelCurrentSpeech();
    if (STATE.abortController) {
      STATE.abortController.abort();
    }
    STATE.abortController = new AbortController();
  }

  function normalizeSettingValue(key, value) {
    if (key === "rate") return String(clampRate(value));
    return value ?? "";
  }

  function playbackProfileSnapshot(settings = STATE.settings) {
    return PLAYBACK_PROFILE_KEYS
      .map((key) => normalizeSettingValue(key, settings[key]))
      .join("\0");
  }

  function invalidateEdgePlaybackCache() {
    STATE.edgeAudioCache.clear();
    revokeNextAudioUrl();
  }

  function isRetriableSpeechError(err) {
    return err?.message === "aborted" || err?.name === "AbortError";
  }

  function switchActivePlayback() {
    invalidateEdgePlaybackCache();
    if (STATE.abortController) {
      STATE.abortController.abort();
    }
    STATE.abortController = new AbortController();

    if (STATE.paused) return;

    cancelCurrentSpeech();

    if (STATE.settings.provider === "edge") {
      const text = STATE.segments[STATE.currentIndex]?.text;
      if (text) {
        ensureEdgeSynthFrame().catch(() => {});
        prefetchEdgeAudio(text, STATE.settings, { priority: true });
        prefetchEdgeAhead(STATE.currentIndex, STATE.settings);
      }
    }
  }

  function applySyncedSettings(changes) {
    const updates = {};
    for (const key of SETTINGS_FIELDS) {
      if (!changes[key]) continue;
      updates[key] = key === "rate" ? clampRate(changes[key].newValue) : changes[key].newValue;
    }
    if (!Object.keys(updates).length) return;

    const prevProfile = playbackProfileSnapshot(STATE.settings);
    const prevRate = clampRate(STATE.settings.rate || 1);

    STATE.settings = { ...STATE.settings, ...updates };

    if (updates.uiLang !== undefined) syncContentUi();
    if (updates.rate !== undefined) syncToolbarRate(STATE.settings.rate);

    if (!STATE.running) return;

    const profileChanged = prevProfile !== playbackProfileSnapshot(STATE.settings);
    const rateChanged = prevRate !== clampRate(STATE.settings.rate || 1);

    if (profileChanged) {
      switchActivePlayback();
      return;
    }

    if (rateChanged && !STATE.paused) {
      setRate(STATE.settings.rate);
    }
  }

  function isActivePlayRequest(requestId) {
    return requestId === STATE.playRequestId && STATE.running;
  }

  function requestReading(startInfo, settings, blockEl) {
    if (!startInfo) return;

    const requestId = ++STATE.playRequestId;
    abortReadingSession();

    const launch = (resolvedSettings) => {
      if (requestId !== STATE.playRequestId) return;

      if (!buildSegments()) {
        alert(t("content.noText"));
        return;
      }

      const resolvedStart = blockEl ? resolveReadStartFromElement(blockEl) : startInfo;
      if (!resolvedStart) {
        alert(t("content.noReadPosition"));
        return;
      }

      STATE.settings = { ...(resolvedSettings || STATE.settings), rate: clampRate((resolvedSettings || STATE.settings).rate || 1) };
      syncContentUi();
      STATE.running = true;
      STATE.paused = false;
      STATE.autoFollow = true;
      hideBackOnTrack();
      attachScrollTracking();
      ensureToolbar();
      updatePauseButton();
      if (resolvedSettings?.provider === "edge") {
        setStatus(t("content.statusPreparing"), "preparing");
        warmEdgeBuffer(
          resolvedStart.index,
          resolvedSettings,
          requestId,
          resolvedStart.textOverride
        ).catch((err) => {
          console.warn("[Brave TTS] Edge buffer warm failed:", err?.message || err);
        });
        setStatus(t("content.statusReading"), "reading");
        readFromIndex(resolvedStart.index, resolvedStart.textOverride, requestId);
        return;
      }

      setStatus(t("content.statusReading"), "reading");
      readFromIndex(resolvedStart.index, resolvedStart.textOverride, requestId);
    };

    if (settings?.provider) {
      launch(settings);
      return;
    }

    if (STATE.settings?.provider) {
      launch(STATE.settings);
      return;
    }

    loadStoredSettings().then((stored) => {
      if (requestId !== STATE.playRequestId) return;
      launch(stored);
    });
  }

  function jumpToStartInfo(startInfo) {
    requestReading(startInfo, STATE.settings, null);
  }

  function applyNativeSelectionHighlight(range) {
    if (!range) return false;
    try {
      const sel = window.getSelection();
      if (!sel) return false;
      sel.removeAllRanges();
      sel.addRange(range);
      return true;
    } catch {
      return false;
    }
  }

  function clearNativeSelection() {
    try {
      const sel = window.getSelection();
      if (sel && sel.rangeCount) sel.removeAllRanges();
    } catch {
      /* ignore */
    }
  }

  function clearHighlights() {
    document.querySelectorAll("[data-brave-tts-imposter='1']").forEach((node) => node.remove());
    if (!isGoogleDocs()) clearNativeSelection();
    safeDeleteHighlight("brave-tts-sentence");
    safeDeleteHighlight("brave-tts-word");
    document.querySelectorAll(".brave-tts-highlight, .brave-tts-word").forEach((el) => {
      el.classList.remove("brave-tts-highlight", "brave-tts-word");
    });
    STATE.highlightEl = null;
  }

  function scrollRangeIntoView(range, { force = false } = {}) {
    if (!range) return;
    if (!force && !STATE.autoFollow) return;

    const rect = range.getBoundingClientRect();
    if (!rect.height) return;

    const margin = window.innerHeight * 0.35;
    const outOfView = rect.top < margin || rect.bottom > window.innerHeight - margin;
    if (!force && !outOfView) return;

    STATE.lastProgrammaticScrollAt = Date.now();
    if (docsHooks.scrollIntoView) {
      docsHooks.scrollIntoView(range, { force });
      return;
    }

    const targetY = window.scrollY + rect.top - window.innerHeight * 0.4;
    window.scrollTo({
      top: Math.max(0, targetY),
      behavior: force ? "smooth" : "auto",
    });
  }

  function setReadingAnchor(range) {
    if (range) STATE.currentReadRange = range;
  }

  function ensureBackOnTrackButton() {
    if (STATE.backOnTrackEl) return STATE.backOnTrackEl;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "brave-tts-back-on-track";
    btn.textContent = t("content.backOnTrack");
    btn.title = t("content.backOnTrackTitle");
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      resumeAutoFollow();
    });
    document.body.appendChild(btn);
    STATE.backOnTrackEl = btn;
    return btn;
  }

  function showBackOnTrack() {
    if (!STATE.running || STATE.autoFollow) return;
    ensureBackOnTrackButton().classList.add("is-visible");
  }

  function hideBackOnTrack() {
    STATE.backOnTrackEl?.classList.remove("is-visible");
  }

  function resumeAutoFollow() {
    if (!STATE.running) return;
    STATE.autoFollow = true;
    hideBackOnTrack();
    const range = STATE.currentReadRange ||
      getSegmentTextRange(STATE.segments[STATE.currentIndex], STATE.segments[STATE.currentIndex]?.text);
    if (range) scrollRangeIntoView(range, { force: true });
  }

  function detachUserScrollIntent() {
    if (!STATE.running || !STATE.autoFollow) return;
    STATE.autoFollow = false;
    showBackOnTrack();
  }

  function onUserScroll() {
    if (!STATE.running) return;
    if (Date.now() - STATE.lastProgrammaticScrollAt < 80) return;
    detachUserScrollIntent();
  }

  function onUserWheel() {
    if (!STATE.running) return;
    detachUserScrollIntent();
  }

  function attachScrollTracking() {
    if (STATE.scrollListenerAttached) return;
    const opts = { passive: true, capture: true };
    window.addEventListener("scroll", onUserScroll, opts);
    document.addEventListener("scroll", onUserScroll, opts);
    window.addEventListener("wheel", onUserWheel, opts);
    document.addEventListener("wheel", onUserWheel, opts);
    window.addEventListener("touchmove", onUserWheel, opts);
    document.addEventListener("touchmove", onUserWheel, opts);
    STATE.scrollListenerAttached = true;
  }

  function detachScrollTracking() {
    if (!STATE.scrollListenerAttached) return;
    const opts = { passive: true, capture: true };
    window.removeEventListener("scroll", onUserScroll, opts);
    document.removeEventListener("scroll", onUserScroll, opts);
    window.removeEventListener("wheel", onUserWheel, opts);
    document.removeEventListener("wheel", onUserWheel, opts);
    window.removeEventListener("touchmove", onUserWheel, opts);
    document.removeEventListener("touchmove", onUserWheel, opts);
    STATE.scrollListenerAttached = false;
  }

  function resetFollowMode() {
    STATE.autoFollow = true;
    STATE.currentReadRange = null;
    hideBackOnTrack();
  }

  function getSegmentTextRange(segment, spokenText) {
    if (segment?.isGoogleDocs && docsHooks.getSegmentRange) {
      return docsHooks.getSegmentRange(segment, spokenText);
    }

    if (!segment?.node) return null;

    let start = segment.startInNode;
    let end = segment.endInNode;
    const nodeText = segment.node.textContent || "";

    if (spokenText && spokenText !== segment.text) {
      const slice = nodeText.slice(segment.startInNode, segment.endInNode);
      const localIdx = slice.indexOf(spokenText.trim());
      if (localIdx >= 0) {
        start = segment.startInNode + localIdx;
        end = start + spokenText.length;
      }
    }

    start = Math.max(0, Math.min(start, nodeText.length));
    end = Math.max(start, Math.min(end, nodeText.length));

    const range = document.createRange();
    range.setStart(segment.node, start);
    range.setEnd(segment.node, end);
    return range;
  }

  function applySentenceHighlight(range) {
    if (!range) return;
    setReadingAnchor(range);
    if (isGoogleDocs()) {
      if (applyNativeSelectionHighlight(range)) {
        scrollRangeIntoView(range);
        return;
      }
      if (STATE.docsPlainMode || STATE.docsA11yMode) {
        scrollRangeIntoView(range);
        return;
      }
    }
    if (!safeSetHighlight("brave-tts-sentence", range)) {
      range.commonAncestorContainer.parentElement?.classList.add("brave-tts-highlight");
      STATE.highlightEl = range.commonAncestorContainer.parentElement;
    }
    scrollRangeIntoView(range);
  }

  function applyWordHighlight(range) {
    if (!range || range.collapsed || isGoogleDocs()) return;
    safeSetHighlight("brave-tts-word", range);
  }

  function highlightSentence(segment, spokenText) {
    document.querySelectorAll(".brave-tts-line-active").forEach((el) => {
      el.classList.remove("brave-tts-line-active");
    });
    segment?.lineEl?.classList?.add("brave-tts-line-active");
    clearHighlights();
    if (docsHooks.highlightSentence) {
      docsHooks.highlightSentence(segment, spokenText);
      return;
    }
    applySentenceHighlight(getSegmentTextRange(segment, spokenText));
  }

  function highlightSpokenProgress(segment, spokenText, charEnd) {
    if (isGoogleDocs()) return;

    const baseRange = getSegmentTextRange(segment, spokenText);
    if (!baseRange) return;
    // Word-level progress highlight only valid within a single text node
    if (baseRange.startContainer !== baseRange.endContainer) return;

    const start = baseRange.startOffset;
    const end = Math.min(baseRange.startOffset + Math.max(1, charEnd), baseRange.endOffset);
    const progress = document.createRange();
    progress.setStart(baseRange.startContainer, start);
    progress.setEnd(baseRange.startContainer, end);
    setReadingAnchor(progress);
    applyWordHighlight(progress);
    scrollRangeIntoView(progress);
  }

  function clearWordHighlight() {
    safeDeleteHighlight("brave-tts-word");
    document.querySelectorAll(".brave-tts-word").forEach((el) => {
      el.classList.remove("brave-tts-word");
    });
  }

  function ensureToolbar() {
    if (STATE.toolbar) return STATE.toolbar;
    const bar = document.createElement("div");
    bar.className = "brave-tts-toolbar";
    bar.innerHTML = `
      <span class="status" data-status="ready">${t("content.toolbarReady")}</span>
      <div class="brave-tts-rate">
        <label class="rate-label" title="${t("content.toolbarRate")}">${t("content.toolbarRate")}</label>
        <button type="button" data-action="slower" title="${t("content.toolbarSlower")}">−</button>
        <input type="range" data-action="rate" min="${MIN_RATE}" max="${MAX_RATE}" step="0.1" value="1" />
        <button type="button" data-action="faster" title="${t("content.toolbarFaster")}">+</button>
        <span class="rate-value">1.0x</span>
      </div>
      <button data-action="pause">${t("content.toolbarPause")}</button>
      <button data-action="stop" class="danger">${t("content.toolbarStop")}</button>
    `;
    bar.addEventListener("click", (e) => {
      const action = e.target.closest("button")?.dataset.action;
      if (action === "pause") togglePause();
      if (action === "stop") stopReading();
      if (action === "slower") setRate(clampRate((STATE.settings.rate || 1) - 0.1));
      if (action === "faster") setRate(clampRate((STATE.settings.rate || 1) + 0.1));
    });
    bar.addEventListener("input", (e) => {
      if (e.target.dataset.action === "rate") {
        setRate(e.target.value);
      }
    });
    document.body.appendChild(bar);
    STATE.toolbar = bar;
    syncToolbarRate(STATE.settings.rate || 1);
    return bar;
  }

  function syncToolbarRate(rate) {
    if (!STATE.toolbar) return;
    const value = clampRate(rate);
    const slider = STATE.toolbar.querySelector('[data-action="rate"]');
    const label = STATE.toolbar.querySelector(".rate-value");
    if (slider) slider.value = String(value);
    if (label) label.textContent = `${value.toFixed(1)}x`;
  }

  function setRate(rate) {
    const next = clampRate(rate);
    const changed = next !== clampRate(STATE.settings.rate || 1);
    STATE.settings.rate = next;
    syncToolbarRate(next);
    try {
      if (isExtensionAlive()) chrome.storage.sync.set({ rate: next });
    } catch (_) { /* extension context gone */ }

    if (!changed || !STATE.running || STATE.paused) return;

    if (STATE.settings.provider === "edge") {
      if (STATE.currentAudio) {
        STATE.currentAudio.playbackRate = next;
      }
      return;
    }

    STATE.speakToken += 1;
    window.speechSynthesis?.cancel();
    if (STATE.currentAudio) {
      STATE.currentAudio.pause();
      STATE.currentAudio = null;
    }
  }

  function setStatus(text, statusKey) {
    const bar = ensureToolbar();
    const statusEl = bar.querySelector(".status");
    statusEl.textContent = text;
    if (statusKey) statusEl.dataset.status = statusKey;
  }

  function updatePauseButton() {
    const btn = STATE.toolbar?.querySelector('[data-action="pause"]');
    if (btn) btn.textContent = STATE.paused ? t("content.toolbarResume") : t("content.toolbarPause");
  }

  function togglePause() {
    if (!STATE.running) return;
    STATE.paused = !STATE.paused;
    updatePauseButton();
    if (STATE.paused) {
      cancelCurrentSpeech();
      setStatus(t("content.statusPaused"), "paused");
    } else {
      setStatus(t("content.statusReading"), "reading");
      readFromIndex(STATE.currentIndex, null, STATE.playRequestId);
    }
  }

  function stopReading() {
    STATE.playRequestId += 1;
    STATE.running = false;
    STATE.paused = false;
    resetFollowMode();
    detachScrollTracking();
    abortReadingSession();
    clearHighlights();
    hideHoverPlayButton();
    hideGesturePrompt();
    STATE.backOnTrackEl?.remove();
    STATE.backOnTrackEl = null;
    STATE.toolbar?.remove();
    STATE.toolbar = null;
    const edgeFrame = document.getElementById("brave-tts-edge-synth");
    if (edgeFrame) edgeFrame.remove();
  }

  async function speakWebSpeech(text, rate, voiceName, lang, segment) {
    if (!window.speechSynthesis) {
      throw new Error(t("error.webSpeechUnsupported"));
    }

    prepareSpeechEngine();
    window.speechSynthesis.cancel();
    window.speechSynthesis.resume();
    const token = STATE.speakToken;
    const voices = window.speechSynthesis.getVoices();

    return new Promise((resolve, reject) => {
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = clampRate(rate);
      utter.lang = lang || "vi-VN";

      const selectedLang = lang || "vi-VN";
      const langBase = selectedLang.split("-")[0];
      const voice = voiceName
        ? voices.find((v) => v.name === voiceName)
        : voices.find((v) => v.lang === selectedLang) ||
          voices.find((v) => v.lang.startsWith(langBase)) ||
          null;
      if (voice) utter.voice = voice;

      const watchdog = setTimeout(() => {
        if (token !== STATE.speakToken) return;
        if (!window.speechSynthesis.speaking && !window.speechSynthesis.pending) {
          reject(new Error("not-allowed"));
        }
      }, 2500);

      const clearWatchdog = () => clearTimeout(watchdog);

      utter.onboundary = (e) => {
        if (token !== STATE.speakToken || !segment) return;
        const charEnd = e.charIndex + (e.charLength || 0);
        highlightSpokenProgress(segment, text, charEnd);
      };

      utter.onend = () => {
        clearWatchdog();
        if (token !== STATE.speakToken) reject(new Error("aborted"));
        else resolve();
      };
      utter.onerror = (e) => {
        clearWatchdog();
        const err = e.error || "speech error";
        if (token !== STATE.speakToken || err === "interrupted") reject(new Error("aborted"));
        else if (err === "not-allowed") {
          reject(new Error("not-allowed"));
        } else reject(new Error(err));
      };

      window.speechSynthesis.speak(utter);
    });
  }

  async function speakAzure(text, settings, segment) {
    const token = STATE.speakToken;
    const { azureKey, azureRegion, azureVoice, rate, lang } = settings;
    const ssmlLang = lang || "vi-VN";
    const ssml = `<speak version='1.0' xml:lang='${ssmlLang}'>
      <voice name='${azureVoice || "vi-VN-HoaiMyNeural"}'>
        <prosody rate='${clampRate(rate)}'>${escapeXml(text)}</prosody>
      </voice>
    </speak>`;

    const res = await fetch(`https://${azureRegion || "southeastasia"}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": azureKey,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-16khz-128kbitrate-mono-mp3",
      },
      body: ssml,
      signal: STATE.abortController?.signal,
    });

    if (token !== STATE.speakToken) throw new Error("aborted");
    if (!res.ok) throw new Error(`Azure TTS: ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    await playAudio(url, clampRate(rate), token, segment, text);
    URL.revokeObjectURL(url);
  }

  async function speakGoogle(text, settings, segment) {
    const token = STATE.speakToken;
    const { googleKey, googleVoice, rate, lang } = settings;
    const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${googleKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: { text },
        voice: {
          languageCode: lang || "vi-VN",
          name: googleVoice || "vi-VN-Neural2-A",
        },
        audioConfig: {
          audioEncoding: "MP3",
          speakingRate: clampRate(rate),
        },
      }),
      signal: STATE.abortController?.signal,
    });

    if (token !== STATE.speakToken) throw new Error("aborted");
    if (!res.ok) throw new Error(`Google TTS: ${res.status}`);
    const data = await res.json();
    const binary = atob(data.audioContent);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: "audio/mp3" });
    const url = URL.createObjectURL(blob);
    await playAudio(url, clampRate(rate), token, segment, text);
    URL.revokeObjectURL(url);
  }

  function ensureEdgeSynthFrame() {
    let frame = document.getElementById("brave-tts-edge-synth");
    if (frame?.dataset.edgeReady === "1") return Promise.resolve(frame);

    if (frame?.dataset.edgePending === "1") {
      return new Promise((resolve) => {
        const waitForReady = (event) => {
          if (event.data?.type !== "EDGE_SYNTH_READY" || event.source !== frame.contentWindow) return;
          window.removeEventListener("message", waitForReady);
          frame.dataset.edgeReady = "1";
          frame.dataset.edgePending = "";
          resolve(frame);
        };
        window.addEventListener("message", waitForReady);
      });
    }

    frame = document.createElement("iframe");
    frame.id = "brave-tts-edge-synth";
    frame.hidden = true;
    frame.dataset.edgePending = "1";
    frame.src = chrome.runtime.getURL("background/edge-synth.html");
    document.documentElement.appendChild(frame);

    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        frame.dataset.edgeReady = "1";
        frame.dataset.edgePending = "";
        window.removeEventListener("message", onReadyMsg);
        resolve(frame);
      };
      const onReadyMsg = (event) => {
        if (event.data?.type !== "EDGE_SYNTH_READY" || event.source !== frame.contentWindow) return;
        done();
      };
      window.addEventListener("message", onReadyMsg);
      frame.addEventListener("load", done, { once: true });
    });
  }

  async function synthesizeViaEdgeFrame({ text, voice, lang, rate, priority = false, streaming = false }) {
    const id = crypto.randomUUID();
    const frame = await ensureEdgeSynthFrame();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        window.removeEventListener("message", onMessage);
        reject(new Error("Edge TTS: timeout"));
      }, 90000);

      const onMessage = (event) => {
        if (event.source !== frame.contentWindow) return;
        if (event.data?.type === "EDGE_SYNTHESIZE_CHUNK" && event.data.id === id) return;
        if (event.data?.type !== "EDGE_SYNTHESIZE_RESULT" || event.data.id !== id) return;
        window.removeEventListener("message", onMessage);
        clearTimeout(timer);
        if (!event.data.ok) {
          reject(new Error(event.data.error || "Edge TTS failed"));
          return;
        }
        if (event.data.audioBuffer) {
          resolve({ audioBytes: new Uint8Array(event.data.audioBuffer) });
          return;
        }
        if (event.data.audioBase64) {
          const binary = atob(event.data.audioBase64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          resolve({ audioBytes: bytes });
          return;
        }
        reject(new Error("Edge TTS: no audio"));
      };

      window.addEventListener("message", onMessage);
      frame.contentWindow.postMessage(
        { type: "EDGE_SYNTHESIZE", id, text, voice, lang, rate, priority, streaming },
        "*"
      );
    });
  }

  function edgeAudioCacheKey(text, settings) {
    const { edgeVoice, lang } = settings;
    return `${edgeVoice || "vi-VN-HoaiMyNeural"}|${lang || "vi-VN"}|${text}`;
  }

  function trimEdgeAudioCache() {
    while (STATE.edgeAudioCache.size > EDGE_AUDIO_CACHE_MAX) {
      const oldestKey = STATE.edgeAudioCache.keys().next().value;
      if (oldestKey === undefined) break;
      STATE.edgeAudioCache.delete(oldestKey);
    }
  }

  function prefetchEdgeAhead(fromIndex, settings, count = EDGE_PREFETCH_AHEAD) {
    if (settings?.provider !== "edge") return;
    for (let offset = 1; offset <= count; offset++) {
      const idx = fromIndex + offset;
      if (idx >= STATE.segments.length) break;
      prefetchEdgeAudio(STATE.segments[idx].text, settings);
    }
  }

  function prefetchEdgeAudio(text, settings, { priority = false } = {}) {
    if (!text || settings?.provider !== "edge") return;
    const key = edgeAudioCacheKey(text, settings);
    const cached = STATE.edgeAudioCache.get(key);
    if (cached instanceof Uint8Array || cached instanceof Promise) return;
    getEdgeAudioBytes(text, settings, { priority }).catch((err) => {
      console.warn("[Brave TTS] Edge prefetch failed:", err?.message || err);
    });
  }

  async function getEdgeAudioBytes(text, settings, { priority = true } = {}) {
    const key = edgeAudioCacheKey(text, settings);
    const cached = STATE.edgeAudioCache.get(key);

    if (cached instanceof Uint8Array && cached.length) return cached;

    if (cached instanceof Promise) {
      const bytes = await cached;
      if (bytes?.length) return bytes;
    }

    const promise = fetchEdgeAudioBytes(text, settings, { priority })
      .then((bytes) => {
        if (bytes?.length) STATE.edgeAudioCache.set(key, bytes);
        else STATE.edgeAudioCache.delete(key);
        return bytes;
      })
      .catch((err) => {
        STATE.edgeAudioCache.delete(key);
        throw err;
      });

    STATE.edgeAudioCache.set(key, promise);
    trimEdgeAudioCache();
    return promise;
  }

  async function warmEdgeBuffer(fromIndex, settings, requestId, firstTextOverride) {
    if (settings?.provider !== "edge") return;
    await ensureEdgeSynthFrame().catch(() => {});
    if (!isActivePlayRequest(requestId)) return;

    const firstText = firstTextOverride || STATE.segments[fromIndex]?.text;
    prefetchEdgeAhead(fromIndex, settings);
    if (!firstText) return;

    prefetchEdgeAudio(firstText, settings, { priority: true });
  }

  function maybePrefetchEdgeOnHover(target) {
    const applyPrefetch = (settings) => {
      if (settings?.provider !== "edge" || !settings.edgeVoice) return;
      if (!STATE.segments.length && !buildSegments()) return;

      const startInfo = resolveReadStartFromElement(target);
      if (!startInfo) return;

      ensureEdgeSynthFrame().catch(() => {});
      const firstText = startInfo.textOverride || STATE.segments[startInfo.index]?.text;
      if (firstText) prefetchEdgeAudio(firstText, settings, { priority: true });
      prefetchEdgeAhead(startInfo.index, settings, EDGE_HOVER_PREFETCH_AHEAD);
    };

    if (STATE.settings?.provider === "edge") {
      applyPrefetch(STATE.settings);
      return;
    }

    loadStoredSettings().then(applyPrefetch);
  }

  async function fetchEdgeAudioBytes(text, settings, { priority = true } = {}) {
    const { edgeVoice, lang } = settings;
    const resp = await synthesizeViaEdgeFrame({
      text,
      voice: edgeVoice || "vi-VN-HoaiMyNeural",
      lang: lang || "vi-VN",
      rate: 1,
      priority,
    });
    return resp.audioBytes;
  }

  async function speakEdge(text, settings, segment) {
    const token = STATE.speakToken;
    const key = edgeAudioCacheKey(text, settings);
    let cached = STATE.edgeAudioCache.get(key);

    if (cached instanceof Promise) {
      try {
        cached = await cached;
      } catch {
        cached = null;
      }
    }

    const needsFetch = !(cached instanceof Uint8Array && cached.length);
    if (needsFetch && STATE.running) {
      setStatus(t("content.statusPreparing"), "preparing");
    }

    prefetchEdgeAhead(STATE.currentIndex, settings);

    const rate = clampRate(settings.rate);
    const preloadedUrl = takeNextAudioUrl();

    if (preloadedUrl) {
      if (token !== STATE.speakToken) {
        URL.revokeObjectURL(preloadedUrl);
        throw new Error("aborted");
      }
      if (STATE.running && !STATE.paused) {
        setStatus(t("content.statusReading"), "reading");
      }
      try {
        await playAudio(preloadedUrl, rate, token, segment, text, settings);
      } finally {
        URL.revokeObjectURL(preloadedUrl);
      }
      prepareNextEdgeAudioUrl(settings, token);
      return;
    }

    let bytes = cached instanceof Uint8Array && cached.length ? cached : null;
    if (!bytes) {
      bytes = await getEdgeAudioBytes(text, settings, { priority: true });
      if (!bytes?.length) throw new Error("Edge TTS: no audio");
    }

    if (token !== STATE.speakToken) throw new Error("aborted");
    if (STATE.running && !STATE.paused) {
      setStatus(t("content.statusReading"), "reading");
    }

    const blob = new Blob([bytes], { type: "audio/mp3" });
    const url = URL.createObjectURL(blob);
    try {
      await playAudio(url, rate, token, segment, text, settings);
    } finally {
      URL.revokeObjectURL(url);
    }
    prepareNextEdgeAudioUrl(settings, token);
  }

  function ensurePlaybackAudio() {
    if (!STATE.playbackAudio) {
      STATE.playbackAudio = new Audio();
    }
    return STATE.playbackAudio;
  }

  function playAudio(url, rate, token, segment, spokenText, settings = STATE.settings) {
    return new Promise((resolve, reject) => {
      const audio = ensurePlaybackAudio();
      const abortSignal = STATE.abortController?.signal;

      if (abortSignal?.aborted) {
        reject(new Error("aborted"));
        return;
      }

      let settled = false;
      const cleanup = () => {
        audio.onended = null;
        audio.onerror = null;
        audio.onplaying = null;
        audio.ontimeupdate = null;
        abortSignal?.removeEventListener("abort", onAbort);
      };

      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        cleanup();
        fn(value);
      };

      const onEnded = () => {
        STATE.currentAudio = null;
        if (token !== STATE.speakToken) finish(reject, new Error("aborted"));
        else finish(resolve);
      };

      const onError = () => {
        STATE.currentAudio = null;
        finish(reject, new Error("Audio playback failed"));
      };

      const onAbort = () => {
        audio.pause();
        STATE.currentAudio = null;
        finish(reject, new Error("aborted"));
      };

      const resolvePlayRate = () => (
        settings?.provider === "edge"
          ? clampRate(STATE.settings.rate)
          : clampRate(rate)
      );

      audio.onended = onEnded;
      audio.onerror = onError;
      audio.ontimeupdate = () => {
        if (token !== STATE.speakToken || !segment || !spokenText || !audio.duration) return;
        const charEnd = Math.ceil((audio.currentTime / audio.duration) * spokenText.length);
        highlightSpokenProgress(segment, spokenText, charEnd);
      };
      audio.onplaying = () => {
        audio.playbackRate = resolvePlayRate();
        if (settings?.provider === "edge") {
          prefetchEdgeAhead(STATE.currentIndex, settings);
          prepareNextEdgeAudioUrl(settings, token);
        }
      };

      abortSignal?.addEventListener("abort", onAbort, { once: true });

      STATE.currentAudio = audio;

      const start = () => {
        audio.playbackRate = resolvePlayRate();
        audio.play().catch((err) => finish(reject, err));
      };

      if (audio.src !== url) {
        audio.src = url;
      }

      if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
        start();
      } else {
        audio.addEventListener("canplay", start, { once: true });
      }
    });
  }

  function escapeXml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function speakSegment(text, segment) {
    const { provider, rate, voice, lang, azureKey, googleKey } = STATE.settings;

    if (provider === "azure") {
      if (!azureKey?.trim()) throw new Error(t("error.azureKeyMissing"));
      await speakAzure(text, STATE.settings, segment);
    } else if (provider === "google") {
      if (!googleKey?.trim()) throw new Error(t("error.googleKeyMissing"));
      await speakGoogle(text, STATE.settings, segment);
    } else if (provider === "edge") {
      if (!STATE.settings.edgeVoice?.trim()) throw new Error(t("error.edgeVoiceMissing"));
      await speakEdge(text, STATE.settings, segment);
    } else {
      await speakWebSpeech(text, rate, voice, lang, segment);
    }
  }

  async function readFromIndex(startIndex, firstSegmentOverride, requestId) {
    const generation = STATE.readGeneration;
    let segmentOverride = firstSegmentOverride;

    for (let i = startIndex; i < STATE.segments.length; i++) {
      if (!isActivePlayRequest(requestId) || generation !== STATE.readGeneration) break;
      while (STATE.paused) {
        await sleep(200);
        if (!isActivePlayRequest(requestId) || generation !== STATE.readGeneration) return;
      }

      STATE.currentIndex = i;
      const segment = STATE.segments[i];
      const spokenText = i === startIndex && segmentOverride ? segmentOverride : segment.text;

      maybeExtendSegments(i);
      highlightSentence(segment, spokenText);
      clearWordHighlight();

      if (!isActivePlayRequest(requestId)) break;

      if (STATE.settings.provider === "edge") {
        prefetchEdgeAhead(i, STATE.settings);
      }

      try {
        for (let retry = 0; retry < 2; retry++) {
          if (!isActivePlayRequest(requestId) || STATE.paused) break;
          try {
            await speakSegment(spokenText, segment);
            break;
          } catch (err) {
            if (retry >= 1 || !isRetriableSpeechError(err) || !isActivePlayRequest(requestId) || STATE.paused) throw err;
          }
        }
      } catch (err) {
        if (err.message === "aborted" || !isActivePlayRequest(requestId)) return;
        if (err.message === "not-allowed") {
          STATE.running = false;
          STATE.paused = false;
          abortReadingSession();
          clearHighlights();
          STATE.toolbar?.remove();
          STATE.toolbar = null;
          resetFollowMode();
          showGesturePrompt(STATE.settings, {
            index: i,
            textOverride: segmentOverride,
          }, segment.element?.closest?.(PARAGRAPH_SELECTOR) || null);
          return;
        }
        console.error("[Brave TTS]", err);
        setStatus(`${t("content.statusErrorPrefix")}${err.message}`);
        return;
      }

      if (!isActivePlayRequest(requestId)) break;

      segmentOverride = null;
      if (STATE.settings.provider !== "edge") {
        await sleep(80);
      }
    }

    if (isActivePlayRequest(requestId) && generation === STATE.readGeneration) {
      setStatus(t("content.statusComplete"), "complete");
      setTimeout(() => {
        if (requestId === STATE.playRequestId) stopReading();
      }, 2000);
    }
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function startReading(settings) {
    showGesturePrompt(settings);
  }

  document.addEventListener("contextmenu", (e) => {
    if (isSkippableTarget(e.target)) return;
    STATE.lastPointer = { x: e.clientX, y: e.clientY };
  }, true);

  document.addEventListener("mousemove", onHoverPointerMove, { passive: true });
  document.addEventListener("pointermove", onHoverPointerMove, { passive: true });
  document.addEventListener("mouseleave", onHoverPointerLeave, { passive: true });

  if (isExtensionAlive()) chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "START_READING") {
      startReading(msg.settings);
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === "READ_FROM_HERE") {
      (async () => {
        if (!buildSegments()) {
          alert(t("content.noText"));
          sendResponse({ ok: false });
          return;
        }

        let startInfo = null;
        let blockEl = null;
        if (msg.useSelection) {
          startInfo = resolveReadStartFromSelection();
        } else if (STATE.lastPointer) {
          startInfo = resolveReadStartFromPoint(STATE.lastPointer.x, STATE.lastPointer.y);
          if (!startInfo) {
            blockEl = findBlockFromTarget(document.elementFromPoint(STATE.lastPointer.x, STATE.lastPointer.y));
            if (blockEl) startInfo = resolveReadStartFromElement(blockEl);
          }
        }

        if (!startInfo) {
          alert(t("content.rightClickToStart"));
          sendResponse({ ok: false });
          return;
        }

        const stored = await loadStoredSettings();
        showGesturePrompt(stored, startInfo, blockEl);
        sendResponse({ ok: true });
      })();
      return true;
    }
    if (msg.type === "STOP_READING") {
      stopReading();
      sendResponse({ ok: true });
    }
    if (msg.type === "GET_VOICES") {
      ensureVoices().then((voices) => {
        sendResponse({
          voices: voices.map((v) => ({ name: v.name, lang: v.lang })),
        });
      });
      return true;
    }
    if (msg.type === "GET_STATUS") {
      sendResponse({
        running: STATE.running,
        paused: STATE.paused,
        total: STATE.segments.length,
        current: STATE.currentIndex,
        rate: STATE.settings.rate || 1,
      });
    }
    if (msg.type === "SET_RATE") {
      setRate(msg.rate);
      sendResponse({ ok: true, rate: STATE.settings.rate });
    }
  });

  if (window.speechSynthesis) {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.addEventListener("voiceschanged", () => {
      window.speechSynthesis.getVoices();
    });
  }

  if (isExtensionAlive()) chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    applySyncedSettings(changes);
  });

  window.__braveTtsApi = {
    STATE,
    t,
    clampRate,
    SKIP_TAGS,
    isVisible,
    PARAGRAPH_SELECTOR,
    trimFromWordBoundary,
    normalizeTextNode,
    getCaretFromPoint,
    resolveReadStart,
    alert: (msg) => window.alert(msg),
    requestReading,
    jumpToStartInfo,
    loadStoredSettings,
    resolveReadStartFromPoint,
    resolveReadStartFromSelection,
    buildSegments,
    isSkippableTarget,
    setStatus,
    scrollRangeIntoView,
    // Shared constants
    SPLIT_TEXT_REGEX: /[^.!?。！？]+[.!?。！？]?/g,
  };

  window.__braveTtsRegisterDocs = function (impl) {
    Object.assign(docsHooks, impl, { active: true });
    impl.init?.();
  };
})();

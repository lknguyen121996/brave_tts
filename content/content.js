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
    wordEls: [],
    toolbar: null,
    abortController: null,
    currentAudio: null,
    speakToken: 0,
    playHereBtn: null,
    lastPointer: null,
    readGeneration: 0,
    paragraphButtonsEnabled: false,
    playRequestId: 0,
    activeParagraphBtn: null,
    hoverTarget: null,
    hoverTimer: null,
    hoverPlayBtn: null,
    hoverPointer: null,
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
  };

  const DOCS_A11Y_RECT_SELECTOR =
    ".kix-canvas-tile-content svg>g>rect[aria-label], " +
    ".kix-canvas-tile-content svg>g[role=paragraph]>rect[aria-label]";

  const PARAGRAPH_SELECTOR = "p, li, blockquote, h1, h2, h3, h4, h5, h6, td, pre";

  const SETTINGS_FIELDS = [
    "uiLang", "provider", "lang", "rate", "voice",
    "azureKey", "azureRegion", "azureVoice",
    "googleKey", "googleVoice",
    "edgeVoice",
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
      const currentStatus = statusEl?.textContent || "";
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
      if (currentStatus === braveTtsT("content.statusReading", "vi") ||
          currentStatus === braveTtsT("content.statusReading", "en")) {
        setStatus(t("content.statusReading"));
      } else if (currentStatus === braveTtsT("content.statusPaused", "vi") ||
                 currentStatus === braveTtsT("content.statusPaused", "en")) {
        setStatus(t("content.statusPaused"));
      } else if (currentStatus === braveTtsT("content.toolbarReady", "vi") ||
                 currentStatus === braveTtsT("content.toolbarReady", "en")) {
        setStatus(t("content.toolbarReady"));
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

    if (STATE.playHereBtn) {
      STATE.playHereBtn.innerHTML =
        `<span class="icon">▶</span> ${t("content.readFromHere")}`;
    }
  }

  const MIN_RATE = 0.5;
  const MAX_RATE = 3;
  const HOVER_PLAY_DELAY_MS = 500;
  const EDGE_PREFETCH_AHEAD = 10;
  const EDGE_AUDIO_CACHE_MAX = 16;

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
    return location.hostname === "docs.google.com";
  }

  function getGoogleDocsEditor() {
    return document.querySelector(".kix-appview-editor") ||
      document.querySelector("#docs-editor-container") ||
      document.querySelector(".docs-editor") ||
      document.querySelector(".kix-rotatingtilemanager-content") ||
      document.querySelector(".docs-editor-container .kix-appview-editor") ||
      document.querySelector(".kix-page-content-wrapper")?.closest(".kix-appview-editor") ||
      document.querySelector("[contenteditable='true'][role='textbox']");
  }

  function getGoogleDocsSurfaceRoots() {
    const roots = new Set();
    const editor = getGoogleDocsEditor();
    if (editor) roots.add(editor);
    document.querySelectorAll(
      "#docs-editor-container, .kix-rotatingtilemanager, .kix-page, .kix-page-content-wrapper"
    ).forEach((el) => roots.add(el));
    return [...roots];
  }

  function isInGoogleDocsEditor(el) {
    if (!el) return false;
    for (const root of getGoogleDocsSurfaceRoots()) {
      if (root.contains(el)) return true;
    }
    return Boolean(el.closest?.(
      ".kix-page, .kix-page-content-wrapper, .kix-canvas-tile-content, .kix-rotatingtilemanager, .kix-lineview-content"
    )) || Boolean(el.matches?.(DOCS_A11Y_RECT_SELECTOR));
  }

  function normalizeDocsText(text) {
    return (text || "")
      .replace(/\u200b/g, "")
      .replace(/\r/g, "")
      .replace(/\s+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n");
  }

  function splitDocsIntoSegments(fullText) {
    const segments = [];
    const parts = fullText.match(/[^\n.!?。！？]+[.!?。！？]?/g) || [fullText];
    let searchFrom = 0;

    for (const part of parts) {
      const text = part.trim();
      if (text.length < 2) continue;
      const idx = fullText.indexOf(part, searchFrom);
      if (idx === -1) continue;
      segments.push({
        text,
        globalStart: idx,
        globalEnd: idx + part.length,
        isGoogleDocs: true,
      });
      searchFrom = idx + part.length;
    }

    if (!segments.length && fullText.trim().length >= 2) {
      segments.push({
        text: fullText.trim(),
        globalStart: 0,
        globalEnd: fullText.length,
        isGoogleDocs: true,
      });
    }

    return segments;
  }

  function buildGoogleDocsLineSegments(entries) {
    const segments = [];

    entries.forEach((entry) => {
      const lineText = entry.text.trim();
      if (lineText.length < 2) return;

      const parts = lineText.match(/[^.!?。！？]+[.!?。！？]?/g) || [lineText];
      let localFrom = 0;

      for (const part of parts) {
        const text = part.trim();
        if (text.length < 2) continue;
        const localIdx = entry.text.indexOf(part, localFrom);
        if (localIdx < 0) continue;
        segments.push({
          text,
          globalStart: entry.start + localIdx,
          globalEnd: entry.start + localIdx + part.length,
          isGoogleDocs: true,
          lineEl: entry.el,
        });
        localFrom = localIdx + part.length;
      }
    });

    return segments;
  }

  function getGoogleDocsHiddenTextContainer() {
    const iframe = document.querySelector("iframe.docs-texteventtarget-iframe");
    try {
      const body = iframe?.contentDocument?.body;
      if (body && normalizeDocsText(body.innerText || "").trim().length >= 2) {
        return body;
      }
    } catch {
      /* cross-origin or unavailable */
    }
    return null;
  }

  function ensureDocsA11yStyles() {
    if (STATE.docsA11yStyleNode?.isConnected) return STATE.docsA11yStyleNode;

    const style = document.createElement("style");
    style.id = "brave-tts-docs-a11y";
    style.textContent = [
      ".kix-canvas-tile-content{pointer-events:none!important;}",
      ".kix-canvas-tile-content svg>g>rect[aria-label]{pointer-events:all!important;}",
      ".kix-canvas-tile-content svg>g[role=paragraph]>rect[aria-label]{pointer-events:all!important;}",
    ].join("\n");
    (document.head || document.documentElement).appendChild(style);
    STATE.docsA11yStyleNode = style;
    return style;
  }

  function setDocsA11yHitTesting(enabled) {
    const style = ensureDocsA11yStyles();
    style.disabled = !enabled;
  }

  function getDocsA11yRects(root = document) {
    ensureDocsA11yStyles();
    return [...root.querySelectorAll(DOCS_A11Y_RECT_SELECTOR)].filter((rect) => {
      const label = rect.getAttribute("aria-label");
      return typeof label === "string" && label.trim().length > 0;
    });
  }

  function joinA11yRectText(parts) {
    return normalizeDocsText(parts.join("")).replace(/\s+/g, " ").trim();
  }

  function groupA11yRectsIntoLines(rects) {
    const items = rects.map((rect) => {
      const box = rect.getBoundingClientRect();
      return {
        rect,
        text: normalizeDocsText(rect.getAttribute("aria-label") || ""),
        top: box.top,
        left: box.left,
        height: box.height,
      };
    }).filter((item) => item.text.length > 0);

    items.sort((a, b) => a.top - b.top || a.left - b.left);

    const lines = [];
    let current = null;
    const LINE_THRESHOLD = 6;

    for (const item of items) {
      if (!current || Math.abs(item.top - current.top) > LINE_THRESHOLD) {
        current = { top: item.top, height: item.height, items: [] };
        lines.push(current);
      }
      current.items.push(item);
      current.top = (current.top + item.top) / 2;
    }

    return lines.map((line) => {
      line.items.sort((a, b) => a.left - b.left);
      const text = joinA11yRectText(line.items.map((item) => item.text));
      const lineEl = line.items[0]?.rect?.closest?.(".kix-lineview, .kix-lineview-content") ||
        line.items[0]?.rect;
      return {
        text,
        rects: line.items.map((item) => item.rect),
        a11yItems: line.items,
        lineEl,
      };
    }).filter((line) => line.text.length >= 2);
  }

  function requestDocsPageExtract() {
    let payload = null;
    const eventId = `brave-tts-docs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const onResult = (event) => {
      if (event.detail?.eventId === eventId) payload = event.detail;
    };
    window.addEventListener("brave-tts-docs-text", onResult);
    window.dispatchEvent(new CustomEvent("brave-tts-docs-extract", { detail: { eventId } }));
    window.removeEventListener("brave-tts-docs-text", onResult);
    return payload;
  }

  function injectDocsPageBridgeRetry() {
    if (!isGoogleDocs() || document.querySelector("script[data-brave-tts-docs-page='1']")) return;
    const extId = chrome.runtime?.id;
    if (!extId) return;

    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("content/docs-page.js");
    script.dataset.braveTtsDocsPage = "1";
    script.dataset.extId = extId;
    (document.head || document.documentElement).appendChild(script);
  }

  function collectGoogleDocsClosureContent() {
    injectDocsPageBridgeRetry();
    const extracted = requestDocsPageExtract();
    const rawText = normalizeDocsText(extracted?.text || "");
    if (rawText.trim().length < 2) return null;

    const entries = [];
    let fullText = "";
    let cursor = 0;
    const lines = rawText.split("\n");

    lines.forEach((line) => {
      const text = line.trim();
      if (text.length < 2) return;
      if (fullText.length > 0) {
        fullText += "\n";
        cursor += 1;
      }
      entries.push({
        el: null,
        rects: null,
        a11yItems: null,
        textNode: null,
        start: cursor,
        end: cursor + text.length,
        text,
        isClosure: true,
      });
      fullText += text;
      cursor += text.length;
    });

    if (fullText.trim().length < 2) return null;
    return { fullText, entries, plainMode: false, mode: "closure" };
  }

  function resolveGoogleDocsStartFromPointClosure(x, y) {
    if (!STATE.docsEntries?.length) return null;

    const surface = document.querySelector(
      ".kix-page-paginated, .kix-rotatingtilemanager-content, .kix-appview-editor, #docs-editor-container"
    );
    if (!surface) {
      return resolveGoogleDocsStartFromOffset(STATE.docsEntries[0].start);
    }

    const rect = surface.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (y - rect.top) / Math.max(1, rect.height)));
    const index = Math.min(
      STATE.docsEntries.length - 1,
      Math.floor(ratio * STATE.docsEntries.length)
    );
    return resolveGoogleDocsStartFromOffset(STATE.docsEntries[index].start);
  }

  function scrollToDocsClosureEntry(entry) {
    if (!entry || !STATE.docsEntries?.length) return;
    const surface = document.querySelector(
      ".kix-page-paginated, .kix-rotatingtilemanager-content, .kix-appview-editor"
    );
    if (!surface) return;

    const idx = STATE.docsEntries.indexOf(entry);
    if (idx < 0) return;

    const rect = surface.getBoundingClientRect();
    const ratio = idx / Math.max(1, STATE.docsEntries.length - 1);
    const targetY = window.scrollY + rect.top + ratio * rect.height - window.innerHeight * 0.35;

    STATE.lastProgrammaticScrollAt = Date.now();
    window.scrollTo({ top: Math.max(0, targetY), behavior: "smooth" });
  }

  function collectGoogleDocsA11yContent() {
    const containers = [
      document.querySelector(".kix-rotatingtilemanager-content"),
      getGoogleDocsEditor(),
      document.querySelector("#docs-editor-container"),
    ].filter(Boolean);

    for (const container of containers) {
      const rects = getDocsA11yRects(container);
      if (rects.length < 2) continue;

      const lines = groupA11yRectsIntoLines(rects);
      if (!lines.length) continue;

      const entries = [];
      let fullText = "";
      let cursor = 0;

      lines.forEach((line, index) => {
        if (index > 0) {
          fullText += "\n";
          cursor += 1;
        }
        entries.push({
          el: line.lineEl,
          rects: line.rects,
          a11yItems: line.a11yItems,
          textNode: null,
          start: cursor,
          end: cursor + line.text.length,
          text: line.text,
          isA11y: true,
        });
        fullText += line.text;
        cursor += line.text.length;
      });

      if (fullText.trim().length >= 2) {
        return { fullText, entries, plainMode: false, mode: "a11y" };
      }
    }

    return null;
  }

  function findA11yLineEntryAtPoint(x, y) {
    if (!STATE.docsEntries?.length) return null;

    for (const entry of STATE.docsEntries) {
      if (!entry.isA11y) continue;

      let minTop = Infinity;
      let maxBottom = -Infinity;
      let minLeft = Infinity;
      let maxRight = -Infinity;

      for (const rect of entry.rects || []) {
        const box = rect.getBoundingClientRect();
        if (!box.width && !box.height) continue;
        minTop = Math.min(minTop, box.top);
        maxBottom = Math.max(maxBottom, box.bottom);
        minLeft = Math.min(minLeft, box.left);
        maxRight = Math.max(maxRight, box.right);
        if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) {
          return entry;
        }
      }

      if (minTop !== Infinity &&
          y >= minTop - 3 &&
          y <= maxBottom + 3 &&
          x >= minLeft - 8 &&
          x <= maxRight + 8) {
        return entry;
      }
    }

    return null;
  }

  function getDocsA11yRectAtPoint(x, y) {
    setDocsA11yHitTesting(true);
    const el = document.elementFromPoint(x, y);
    setDocsA11yHitTesting(false);
    if (el?.matches?.(DOCS_A11Y_RECT_SELECTOR)) return el;
    return null;
  }

  function getGoogleDocsHoverTarget(x, y) {
    const lineEntry = findA11yLineEntryAtPoint(x, y);
    if (lineEntry) return lineEntry.el || lineEntry.rects?.[0] || null;

    const a11yRect = getDocsA11yRectAtPoint(x, y);
    if (a11yRect) {
      return a11yRect.closest(".kix-lineview, .kix-lineview-content") || a11yRect;
    }

    const surface = document.querySelector(
      ".kix-page-paginated, .kix-rotatingtilemanager-content, .kix-appview-editor, #docs-editor-container"
    );
    if (surface) {
      const rect = surface.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return surface;
      }
    }

    const el = document.elementFromPoint(x, y);
    if (!el || !isInGoogleDocsEditor(el)) return null;
    return el.closest(".kix-lineview-content, .kix-lineview");
  }

  function createA11yTextRange(rect, text, startOffset = 0, endOffset = text.length) {
    if (!rect || !text) return null;

    try {
      startOffset = Math.max(0, Math.min(startOffset, text.length));
      endOffset = Math.max(startOffset, Math.min(endOffset, text.length));
      if (startOffset >= endOffset) {
        endOffset = Math.min(text.length, startOffset + 1);
      }

      const content = document.createTextNode(text);
      const svgText = document.createElementNS("http://www.w3.org/2000/svg", "text");
      const transform = rect.getAttribute("transform") || "";
      const font = rect.getAttribute("data-font-css") || "";
      const elementX = rect.getAttribute("x");
      const elementY = rect.getAttribute("y");
      if (elementX) svgText.setAttribute("x", elementX);
      if (elementY) svgText.setAttribute("y", elementY);
      svgText.appendChild(content);
      svgText.dataset.braveTtsImposter = "1";
      svgText.style.setProperty("all", "initial", "important");
      svgText.style.setProperty("transform", transform, "important");
      svgText.style.setProperty("font", font, "important");
      svgText.style.setProperty("text-anchor", "start", "important");

      const parent = rect.parentNode;
      if (!parent) return null;
      parent.appendChild(svgText);

      const elementRect = rect.getBoundingClientRect();
      const textRect = svgText.getBoundingClientRect();
      const yOffset = ((elementRect.top - textRect.top) + (elementRect.bottom - textRect.bottom)) * 0.5;
      svgText.style.setProperty("transform", `translate(0px,${yOffset}px) ${transform}`, "important");

      const range = document.createRange();
      range.setStart(content, startOffset);
      range.setEnd(content, endOffset);

      svgText.style.setProperty("pointer-events", "none", "important");
      svgText.style.setProperty("opacity", "0", "important");
      return range;
    } catch {
      return null;
    }
  }

  function getA11yRangeForEntry(entry, globalStart, globalEnd) {
    if (!entry?.isA11y || !entry.text) return null;

    const localStart = Math.max(0, globalStart - entry.start);
    const localEnd = Math.min(entry.text.length, globalEnd - entry.start);
    const anchorRect = entry.rects?.[0];
    if (!anchorRect) return null;

    return createA11yTextRange(anchorRect, entry.text, localStart, localEnd);
  }

  function tryEnableDocsScreenReader() {
    if (STATE.docsScreenReaderTried) return;
    STATE.docsScreenReaderTried = true;

    setTimeout(() => {
      try {
        const iframe = document.querySelector("iframe.docs-texteventtarget-iframe");
        const doc = iframe?.contentDocument;
        const target = doc?.activeElement || doc?.body;
        if (!target) return;

        const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
        target.dispatchEvent(new KeyboardEvent("keydown", {
          key: "t",
          code: "KeyT",
          altKey: !isMac,
          shiftKey: !isMac,
          ctrlKey: isMac,
          metaKey: false,
          bubbles: true,
          cancelable: true,
        }));
      } catch {
        /* best effort */
      }
    }, 2500);
  }

  function scheduleDocsA11yPoll() {
    if (STATE.docsA11yPollDone) return;

    let attempts = 0;
    const tick = () => {
      if (attempts++ > 60) {
        STATE.docsA11yPollDone = true;
        return;
      }

      if (getDocsA11yRects(document).length >= 2) {
        buildGoogleDocsSegments();
        STATE.docsA11yPollDone = true;
        return;
      }

      setTimeout(tick, 500);
    };

    tick();
  }

  function collectGoogleDocsContent() {
    const a11yCollected = collectGoogleDocsA11yContent();
    if (a11yCollected) return a11yCollected;

    const closureCollected = collectGoogleDocsClosureContent();
    if (closureCollected) return closureCollected;

    const editor = getGoogleDocsEditor();
    const hiddenText = getGoogleDocsHiddenTextContainer();
    const containers = [
      editor,
      document.querySelector("#docs-editor-container"),
      document.querySelector(".kix-rotatingtilemanager-content"),
    ].filter(Boolean);

    const entries = [];
    let fullText = "";
    let plainMode = false;

    const appendFromElements = (elements, { joiner = "" } = {}) => {
      entries.length = 0;
      fullText = "";
      let cursor = 0;
      let added = 0;

      elements.forEach((el) => {
        const text = normalizeDocsText(el.textContent || "");
        if (!text) return;
        if (added > 0 && joiner) {
          fullText += joiner;
          cursor += joiner.length;
        }
        const textNode = [...el.childNodes].find((n) => n.nodeType === Node.TEXT_NODE) || null;
        entries.push({
          el,
          textNode,
          start: cursor,
          end: cursor + text.length,
          text,
        });
        fullText += text;
        cursor += text.length;
        added += 1;
      });

      return added > 0 && fullText.trim().length >= 2;
    };

    for (const container of containers) {
      entries.length = 0;
      fullText = "";
      plainMode = false;

      const lineNodes = container.querySelectorAll(".kix-lineview-content");
      if (lineNodes.length && appendFromElements(lineNodes, { joiner: "\n" })) {
        return { fullText, entries, plainMode, mode: "lines" };
      }

      entries.length = 0;
      fullText = "";
      const wordNodes = container.querySelectorAll(".kix-wordhtmlgenerator-word-node");
      if (wordNodes.length && appendFromElements(wordNodes)) {
        return { fullText, entries, plainMode, mode: "words" };
      }

      entries.length = 0;
      fullText = "";
      const svgTextNodes = container.querySelectorAll(
        ".kix-canvas-tile-content text, .kix-canvas-tile-content tspan, .kix-a11y-text"
      );
      if (svgTextNodes.length && appendFromElements(svgTextNodes, { joiner: " " })) {
        return { fullText, entries, plainMode, mode: "svg" };
      }

      entries.length = 0;
      fullText = "";
      const pages = container.querySelectorAll(".kix-page-content-wrapper, .kix-page");
      if (pages.length && appendFromElements(pages, { joiner: "\n" })) {
        return { fullText, entries, plainMode, mode: "pages" };
      }
    }

    entries.length = 0;
    fullText = "";
    const plainSources = [
      hiddenText,
      document.querySelector(".kix-appview-editor"),
      document.querySelector(".kix-rotatingtilemanager-content"),
      document.querySelector("#docs-editor-container"),
    ].filter(Boolean);

    for (const container of plainSources) {
      const text = normalizeDocsText(container.innerText || "");
      if (text.trim().length >= 2) {
        fullText = text;
        plainMode = true;
        return { fullText, entries, plainMode, mode: "plain" };
      }
    }

    return null;
  }

  function getReadableRoot() {
    if (isGoogleDocs()) {
      const editor = getGoogleDocsEditor();
      if (editor && editor.innerText.replace(/\s+/g, " ").trim().length > 10) return editor;
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
        const inDocsEditor = isGoogleDocs() && isInGoogleDocsEditor(parent);
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
    return !el || el.closest(".brave-tts-toolbar, .brave-tts-play-here, .brave-tts-hover-play, .brave-tts-para-play, .brave-tts-back-on-track, .brave-tts-gesture-prompt");
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

    if (isGoogleDocs()) {
      const lineEl = el.closest?.(".kix-lineview-content, .kix-lineview") || el;
      const a11yEntry = STATE.docsEntries?.find((item) =>
        item.isA11y && (
          item.el === el ||
          item.el === lineEl ||
          item.rects?.includes(el) ||
          item.rects?.some((rect) => lineEl.contains?.(rect) || rect.contains?.(el))
        )
      );
      if (a11yEntry) return resolveGoogleDocsStartFromOffset(a11yEntry.start);

      for (let i = 0; i < STATE.segments.length; i++) {
        const seg = STATE.segments[i];
        if (seg.lineEl && (seg.lineEl === lineEl || lineEl.contains(seg.lineEl) || seg.lineEl.contains(lineEl))) {
          return { index: i, textOverride: null };
        }
      }
      const entry = STATE.docsEntries?.find((item) =>
        item.el === lineEl || lineEl.contains(item.el) || item.el?.contains(lineEl)
      );
      if (entry) return resolveGoogleDocsStartFromOffset(entry.start);
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
    if (isGoogleDocs()) {
      return target?.closest?.(".kix-lineview-content, .kix-lineview") ||
        target?.closest?.(DOCS_A11Y_RECT_SELECTOR);
    }
    return target?.closest?.(PARAGRAPH_SELECTOR) ||
      target?.closest?.("article, main, section, div[data-brave-tts-block]");
  }

  function getHoverReadingTarget(x, y) {
    if (isGoogleDocs()) {
      const target = getGoogleDocsHoverTarget(x, y);
      if (!target || isSkippableTarget(target)) return null;
      const entry = findA11yLineEntryAtPoint(x, y);
      if (entry?.text?.length >= 2) return entry.el || entry.rects?.[0] || target;
      if (target.matches?.(DOCS_A11Y_RECT_SELECTOR)) return target;
      if (target.closest?.(".kix-appview-editor, .kix-page-paginated, .kix-rotatingtilemanager-content")) {
        return target.closest(".kix-appview-editor, .kix-page-paginated, .kix-rotatingtilemanager-content");
      }
      if (target.textContent?.replace(/\s+/g, " ").trim().length >= 2) return target;
      return null;
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
      startReadingFromTarget(target, STATE.hoverPointer);
    }, true);

    btn.addEventListener("pointerdown", (e) => e.stopPropagation(), true);
    document.body.appendChild(btn);
    STATE.hoverPlayBtn = btn;
  }

  async function startReadingFromTarget(target, point) {
    if (!target) return;

    if (isGoogleDocs()) {
      if (!buildGoogleDocsSegments()) {
        showGoogleDocsHint(t("content.docsNotReady"));
        return;
      }
      let startInfo = resolveReadStartFromElement(target);
      const coords = point || STATE.hoverPointer || STATE.lastPointer;
      if (!startInfo && coords) {
        startInfo = resolveGoogleDocsStartFromPoint(coords.x, coords.y);
      }
      if (!startInfo) {
        showGoogleDocsHint(t("content.docsLineUnknown"));
        return;
      }
      if (STATE.running) {
        jumpToStartInfo(startInfo);
        return;
      }
      const stored = await loadStoredSettings();
      requestReading(startInfo, stored, null);
      return;
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

  function onHoverPointerMove(e) {
    if (e.target?.closest?.(".brave-tts-hover-play")) return;
    STATE.hoverPointer = { x: e.clientX, y: e.clientY };

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
    }, HOVER_PLAY_DELAY_MS);
  }

  function onHoverPointerLeave() {
    STATE.hoverTarget = null;
    clearHoverPlayTimer();
    hideHoverPlayButton();
  }

  function readFromParagraph(blockEl) {
    if (!blockEl) return;
    if (!buildSegments()) {
      alert(t("content.noText"));
      return;
    }

    const startInfo = resolveReadStartFromElement(blockEl);
    if (!startInfo) {
      alert(t("content.noReadPositionInBlock"));
      return;
    }

    requestReading(startInfo, null, blockEl);
  }

  function setActiveParagraphButton(blockEl) {
    if (STATE.activeParagraphBtn) {
      STATE.activeParagraphBtn.classList.remove("is-active");
      STATE.activeParagraphBtn = null;
    }
    if (!blockEl) return;
    const btn = blockEl.querySelector(":scope > .brave-tts-para-play");
    if (btn) {
      btn.classList.add("is-active");
      STATE.activeParagraphBtn = btn;
    }
  }

  function clearActiveParagraphButton() {
    setActiveParagraphButton(null);
  }

  function removeParagraphPlayButtons() {
    document.querySelectorAll(".brave-tts-para-play").forEach((btn) => btn.remove());
    document.querySelectorAll(".brave-tts-para-wrap").forEach((el) => {
      el.classList.remove("brave-tts-para-wrap");
    });
  }

  function installParagraphPlayButtons() {
    removeParagraphPlayButtons();
  }

  function scheduleParagraphPlayButtons() {
    removeParagraphPlayButtons();
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

  function getGlobalOffsetInEditor(node, offset) {
    const caret = normalizeTextNode(node, offset);
    if (!caret) return -1;

    if (STATE.docsEntries?.length) {
      for (const entry of STATE.docsEntries) {
        if (entry.isA11y && entry.rects?.includes(caret.node)) {
          return entry.start;
        }
        if (entry.textNode === caret.node) {
          return Math.min(entry.end, entry.start + caret.offset);
        }
        if (entry.el?.contains(caret.node)) {
          return entry.start;
        }
      }
    }

    const editor = getGoogleDocsEditor();
    if (!editor) return -1;

    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let cursor = 0;
    while (walker.nextNode()) {
      const textNode = walker.currentNode;
      if (textNode === caret.node) {
        return cursor + caret.offset;
      }
      cursor += textNode.textContent.length;
    }
    return -1;
  }

  function resolveGoogleDocsStartFromOffset(globalOffset) {
    if (globalOffset < 0 || !STATE.segments.length) return null;

    for (let i = 0; i < STATE.segments.length; i++) {
      const seg = STATE.segments[i];
      if (globalOffset >= seg.globalStart && globalOffset < seg.globalEnd) {
        const slice = STATE.docsFullText.slice(globalOffset, seg.globalEnd);
        const textOverride = trimFromWordBoundary(slice);
        return { index: i, textOverride: textOverride || null };
      }
      if (globalOffset < seg.globalStart) {
        return { index: i, textOverride: null };
      }
    }

    return { index: STATE.segments.length - 1, textOverride: null };
  }

  function resolveGoogleDocsStartFromSelection() {
    const sources = [window.getSelection()];

    try {
      const iframe = document.querySelector("iframe.docs-texteventtarget-iframe");
      const iframeSel = iframe?.contentDocument?.getSelection?.();
      if (iframeSel) sources.push(iframeSel);
    } catch {
      /* ignore */
    }

    for (const sel of sources) {
      if (!sel?.rangeCount) continue;

      const range = sel.getRangeAt(0);
      const globalOffset = getGlobalOffsetInEditor(range.startContainer, range.startOffset);
      if (globalOffset >= 0) {
        return resolveGoogleDocsStartFromOffset(globalOffset);
      }

      const selected = normalizeDocsText(sel.toString()).trim();
      if (selected.length >= 1 && STATE.docsFullText) {
        let idx = STATE.docsFullText.indexOf(selected);
        if (idx < 0) {
          idx = STATE.docsFullText.toLowerCase().indexOf(selected.toLowerCase());
        }
        if (idx >= 0) return resolveGoogleDocsStartFromOffset(idx);
      }
    }

    return null;
  }

  function resolveGoogleDocsStartFromPoint(x, y) {
    const startFromSelection = resolveGoogleDocsStartFromSelection();
    if (startFromSelection) return startFromSelection;

    if (STATE.docsClosureMode) {
      return resolveGoogleDocsStartFromPointClosure(x, y);
    }

    const lineEntry = findA11yLineEntryAtPoint(x, y);
    if (lineEntry) return resolveGoogleDocsStartFromOffset(lineEntry.start);

    const a11yRect = getDocsA11yRectAtPoint(x, y);
    if (a11yRect) {
      const entry = STATE.docsEntries?.find((item) => item.isA11y && item.rects?.includes(a11yRect));
      if (entry) return resolveGoogleDocsStartFromOffset(entry.start);
    }

    const caret = getCaretFromPoint(x, y);
    if (!caret) return null;
    const globalOffset = getGlobalOffsetInEditor(caret.node, caret.offset);
    return resolveGoogleDocsStartFromOffset(globalOffset);
  }

  function getGoogleDocsRange(globalStart, globalEnd) {
    if (STATE.docsEntries?.length) {
      try {
        const startEntry = STATE.docsEntries.find(
          (entry) => globalStart >= entry.start && globalStart <= entry.end
        );
        if (startEntry?.isA11y) {
          return getA11yRangeForEntry(startEntry, globalStart, globalEnd);
        }

        const range = document.createRange();
        let startSet = false;

        for (const entry of STATE.docsEntries) {
          if (entry.isA11y) continue;
          if (!startSet && globalStart >= entry.start && globalStart <= entry.end) {
            const node = entry.textNode || entry.el;
            const offset = entry.textNode
              ? Math.min(entry.textNode.textContent.length, globalStart - entry.start)
              : 0;
            range.setStart(node, offset);
            startSet = true;
          }
          if (startSet && globalEnd >= entry.start && globalEnd <= entry.end) {
            const node = entry.textNode || entry.el;
            const offset = entry.textNode
              ? Math.min(entry.textNode.textContent.length, globalEnd - entry.start)
              : (entry.el?.childNodes?.length || 0);
            range.setEnd(node, offset);
            return range;
          }
        }
      } catch {
        /* fall through */
      }
    }

    const editor = getGoogleDocsEditor();
    if (!editor) return null;

    try {
      const range = document.createRange();
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
      let cursor = 0;
      let startNode = null;
      let startOffset = 0;
      let endNode = null;
      let endOffset = 0;

      while (walker.nextNode()) {
        const node = walker.currentNode;
        const len = node.textContent.length;
        const nextCursor = cursor + len;

        if (!startNode && globalStart >= cursor && globalStart <= nextCursor) {
          startNode = node;
          startOffset = Math.max(0, globalStart - cursor);
        }

        if (startNode && globalEnd >= cursor && globalEnd <= nextCursor) {
          endNode = node;
          endOffset = Math.max(0, globalEnd - cursor);
          break;
        }

        cursor = nextCursor;
      }

      if (!startNode || !endNode) return null;
      range.setStart(startNode, startOffset);
      range.setEnd(endNode, endOffset);
      return range;
    } catch {
      return null;
    }
  }

  function buildGoogleDocsSegments() {
    const collected = collectGoogleDocsContent();
    if (!collected) return false;

    STATE.docsFullText = collected.fullText;
    STATE.docsEntries = collected.entries;
    STATE.docsPlainMode = collected.plainMode;
    STATE.docsA11yMode = collected.mode === "a11y";
    STATE.docsClosureMode = collected.mode === "closure";
    if (collected.entries.length && collected.mode === "lines") {
      STATE.segments = buildGoogleDocsLineSegments(collected.entries);
    } else if (collected.entries.length) {
      STATE.segments = buildGoogleDocsLineSegments(collected.entries);
      if (!STATE.segments.length) {
        STATE.segments = splitDocsIntoSegments(collected.fullText);
      }
    } else {
      STATE.segments = splitDocsIntoSegments(collected.fullText);
    }
    return STATE.segments.length > 0;
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
    if (isGoogleDocs()) {
      if (!STATE.segments.length) buildGoogleDocsSegments();
      return resolveGoogleDocsStartFromPoint(x, y);
    }
    const caret = getCaretFromPoint(x, y);
    if (!caret) return null;
    return resolveReadStart(caret.node, caret.offset);
  }

  function resolveReadStartFromSelection() {
    if (isGoogleDocs()) {
      if (!STATE.segments.length) buildGoogleDocsSegments();
      return resolveGoogleDocsStartFromSelection();
    }
    const sel = window.getSelection();
    if (!sel?.rangeCount) return null;
    const range = sel.getRangeAt(0);
    return resolveReadStart(range.startContainer, range.startOffset);
  }

  function loadStoredSettings() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(SETTINGS_FIELDS, (data) => {
        resolve({ ...data, rate: clampRate(data.rate || 1) });
      });
    });
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

      const done = () => {
        window.speechSynthesis.onvoiceschanged = null;
        resolve(window.speechSynthesis.getVoices());
      };

      window.speechSynthesis.onvoiceschanged = done;
      setTimeout(done, 800);
    });
  }

  function prepareSpeechEngine() {
    if (!window.speechSynthesis) return;
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    }
  }

  function hidePlayHereButton() {
    STATE.playHereBtn?.remove();
    STATE.playHereBtn = null;
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

  function showPlayHereButton(x, y, startInfo) {
    hidePlayHereButton();
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "brave-tts-play-here";
    btn.innerHTML = `<span class="icon">▶</span> ${t("content.readFromHere")}`;
    btn.style.left = `${Math.min(x, window.innerWidth - 160)}px`;
    btn.style.top = `${Math.max(12, y - 48)}px`;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      hidePlayHereButton();
      beginReadingFromStartInfo(startInfo);
    });
    document.body.appendChild(btn);
    STATE.playHereBtn = btn;
  }

  function showPlayHereAtSelection(startInfo) {
    const sel = window.getSelection();
    if (!sel?.rangeCount) return;
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top;
    showPlayHereButton(x, y, startInfo);
  }

  function buildSegments() {
    if (isGoogleDocs()) return buildGoogleDocsSegments();

    const root = getReadableRoot();
    const textNodes = collectTextNodes(root);
    STATE.segments = splitIntoSegments(textNodes);
    return STATE.segments.length > 0;
  }

  function maybeExtendGoogleDocsSegments(currentIndex) {
    if (!isGoogleDocs() || currentIndex < STATE.segments.length - 4) return;
    const prevLength = STATE.segments.length;
    buildSegments();
    if (STATE.segments.length > prevLength) {
      setStatus(t("content.statusReading"));
    }
  }

  function cancelCurrentSpeech() {
    STATE.speakToken += 1;
    window.speechSynthesis?.cancel();
    if (STATE.currentAudio) {
      STATE.currentAudio.pause();
      STATE.currentAudio = null;
    }
  }

  function abortReadingSession() {
    STATE.readGeneration += 1;
    STATE.edgeAudioCache.clear();
    cancelCurrentSpeech();
    if (STATE.abortController) {
      STATE.abortController.abort();
    }
    STATE.abortController = new AbortController();
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
      hidePlayHereButton();
      hideBackOnTrack();
      attachScrollTracking();
      ensureToolbar();
      updatePauseButton();
      setActiveParagraphButton(blockEl || null);
      setStatus(t("content.statusReading"));
      if (resolvedSettings?.provider === "edge") {
        ensureEdgeSynthFrame().catch(() => {});
        const firstText =
          resolvedStart.textOverride || STATE.segments[resolvedStart.index]?.text;
        if (firstText) prefetchEdgeAudio(firstText, resolvedSettings);
        prefetchEdgeAhead(resolvedStart.index, resolvedSettings);
      }
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

  function beginReadingFromStartInfo(startInfo, settings) {
    requestReading(startInfo, settings, null);
  }

  function jumpToStartInfo(startInfo) {
    requestReading(startInfo, STATE.settings, null);
  }

  async function handleReadFromPoint(x, y, { jumpIfRunning = false, showButton = false, target = null } = {}) {
    if (!buildSegments()) {
      alert(t("content.noText"));
      return;
    }

    let startInfo = resolveReadStartFromPoint(x, y);
    if (!startInfo && target) {
      const block = findBlockFromTarget(target);
      if (block) startInfo = resolveReadStartFromElement(block);
    }
    if (!startInfo) {
      alert(t("content.noReadPositionAtPoint"));
      return;
    }

    if (showButton) {
      showPlayHereButton(x, y, startInfo);
      return;
    }

    if (jumpIfRunning && STATE.running) {
      jumpToStartInfo(startInfo);
      return;
    }

    beginReadingFromStartInfo(startInfo);
  }

  async function handleReadFromSelection({ showButton = false } = {}) {
    if (!buildSegments()) {
      alert(t("content.noText"));
      return;
    }

    const startInfo = resolveReadStartFromSelection();
    if (!startInfo) {
      alert(t("content.noReadPositionInSelection"));
      return;
    }

    if (showButton) {
      showPlayHereAtSelection(startInfo);
      return;
    }

    beginReadingFromStartInfo(startInfo);
  }

  function showGoogleDocsHint(message) {
    document.querySelector(".brave-tts-docs-hint")?.remove();
    const hint = document.createElement("div");
    hint.className = "brave-tts-docs-hint";
    hint.textContent = message || t("content.docsHintDefault");
    document.body.appendChild(hint);
    setTimeout(() => hint.classList.add("is-visible"), 30);
    setTimeout(() => {
      hint.classList.remove("is-visible");
      setTimeout(() => hint.remove(), 300);
    }, 5000);
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
    if (isGoogleDocs()) clearNativeSelection();
    safeDeleteHighlight("brave-tts-sentence");
    safeDeleteHighlight("brave-tts-word");
    document.querySelectorAll(".brave-tts-highlight, .brave-tts-word").forEach((el) => {
      el.classList.remove("brave-tts-highlight", "brave-tts-word");
    });
    STATE.highlightEl = null;
    STATE.wordEls = [];
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
    if (isGoogleDocs()) {
      const el = range.startContainer.nodeType === Node.TEXT_NODE
        ? range.startContainer.parentElement
        : range.startContainer;
      el?.scrollIntoView({
        block: "center",
        behavior: force ? "smooth" : "auto",
      });
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

  function resetFollowMode() {
    STATE.autoFollow = true;
    STATE.currentReadRange = null;
    hideBackOnTrack();
  }

  function getSegmentTextRange(segment, spokenText) {
    if (segment?.isGoogleDocs) {
      let start = segment.globalStart;
      let end = segment.globalEnd;

      if (spokenText && spokenText !== segment.text) {
        const localIdx = segment.text.indexOf(spokenText.trim());
        if (localIdx >= 0) {
          start = segment.globalStart + localIdx;
          end = start + spokenText.length;
        }
      }

      return getGoogleDocsRange(start, end);
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
    if (!range || range.collapsed) return;
    if (isGoogleDocs()) {
      applyNativeSelectionHighlight(range);
      return;
    }
    safeSetHighlight("brave-tts-word", range);
  }

  function highlightSentence(segment, spokenText) {
    document.querySelectorAll(".brave-tts-line-active").forEach((el) => {
      el.classList.remove("brave-tts-line-active");
    });
    segment?.lineEl?.classList?.add("brave-tts-line-active");
    clearHighlights();
    if (isGoogleDocs() && STATE.docsClosureMode) {
      const entry = STATE.docsEntries?.find(
        (item) => segment.globalStart >= item.start && segment.globalStart <= item.end
      );
      scrollToDocsClosureEntry(entry);
      return;
    }
    applySentenceHighlight(getSegmentTextRange(segment, spokenText));
  }

  function highlightSpokenProgress(segment, spokenText, charEnd) {
    const baseRange = getSegmentTextRange(segment, spokenText);
    if (!baseRange) return;

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
      <span class="status">${t("content.toolbarReady")}</span>
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
    chrome.storage.sync.set({ rate: next });

    if (!changed || !STATE.running || STATE.paused) return;

    STATE.speakToken += 1;
    window.speechSynthesis?.cancel();
    if (STATE.currentAudio) {
      STATE.currentAudio.pause();
      STATE.currentAudio = null;
    }
  }

  function setStatus(text) {
    const bar = ensureToolbar();
    bar.querySelector(".status").textContent = text;
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
      setStatus(t("content.statusPaused"));
    } else {
      setStatus(t("content.statusReading"));
      readFromIndex(STATE.currentIndex, null, STATE.playRequestId);
    }
  }

  function stopReading() {
    STATE.playRequestId += 1;
    STATE.running = false;
    STATE.paused = false;
    resetFollowMode();
    abortReadingSession();
    clearHighlights();
    hidePlayHereButton();
    hideHoverPlayButton();
    hideGesturePrompt();
    clearActiveParagraphButton();
    STATE.backOnTrackEl?.remove();
    STATE.backOnTrackEl = null;
    STATE.toolbar?.remove();
    STATE.toolbar = null;
    scheduleParagraphPlayButtons();
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

  async function synthesizeViaEdgeFrame({ text, voice, lang, rate }) {
    const id = crypto.randomUUID();
    const frame = await ensureEdgeSynthFrame();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        window.removeEventListener("message", onMessage);
        reject(new Error("Edge TTS: timeout"));
      }, 60000);

      const onMessage = (event) => {
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
        { type: "EDGE_SYNTHESIZE", id, text, voice, lang, rate },
        "*"
      );
    });
  }

  function edgeAudioCacheKey(text, settings) {
    const { edgeVoice, rate, lang } = settings;
    return `${edgeVoice || "vi-VN-HoaiMyNeural"}|${lang || "vi-VN"}|${clampRate(rate)}|${text}`;
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

  function prefetchEdgeAudio(text, settings) {
    if (!text || settings?.provider !== "edge") return;
    const key = edgeAudioCacheKey(text, settings);
    if (STATE.edgeAudioCache.has(key)) return;
    STATE.edgeAudioCache.set(
      key,
      fetchEdgeAudioBytes(text, settings).catch((err) => {
        STATE.edgeAudioCache.delete(key);
        throw err;
      })
    );
    trimEdgeAudioCache();
  }

  async function fetchEdgeAudioBytes(text, settings) {
    const { edgeVoice, rate, lang } = settings;
    const resp = await synthesizeViaEdgeFrame({
      text,
      voice: edgeVoice || "vi-VN-HoaiMyNeural",
      lang: lang || "vi-VN",
      rate: clampRate(rate),
    });
    return resp.audioBytes;
  }

  async function speakEdge(text, settings, segment) {
    const token = STATE.speakToken;
    const key = edgeAudioCacheKey(text, settings);
    let bytesPromise = STATE.edgeAudioCache.get(key);
    if (bytesPromise) STATE.edgeAudioCache.delete(key);
    else bytesPromise = fetchEdgeAudioBytes(text, settings);

    let bytes;
    try {
      bytes = await bytesPromise;
    } catch {
      bytes = await fetchEdgeAudioBytes(text, settings);
    }

    if (token !== STATE.speakToken) throw new Error("aborted");

    const blob = new Blob([bytes], { type: "audio/mp3" });
    const url = URL.createObjectURL(blob);
    prefetchEdgeAhead(STATE.currentIndex, settings);
    await playAudio(url, clampRate(settings.rate), token, segment, text);
    URL.revokeObjectURL(url);
  }

  function playAudio(url, rate, token, segment, spokenText) {
    return new Promise((resolve, reject) => {
      const audio = new Audio(url);
      audio.playbackRate = clampRate(rate);
      STATE.currentAudio = audio;

      audio.ontimeupdate = () => {
        if (token !== STATE.speakToken || !segment || !spokenText || !audio.duration) return;
        const charEnd = Math.ceil((audio.currentTime / audio.duration) * spokenText.length);
        highlightSpokenProgress(segment, spokenText, charEnd);
      };

      audio.onplaying = () => {
        if (STATE.settings?.provider === "edge") {
          prefetchEdgeAhead(STATE.currentIndex, STATE.settings);
        }
      };

      audio.onended = () => {
        STATE.currentAudio = null;
        if (token !== STATE.speakToken) reject(new Error("aborted"));
        else resolve();
      };
      audio.onerror = () => {
        STATE.currentAudio = null;
        reject(new Error("Audio playback failed"));
      };
      STATE.abortController?.signal.addEventListener("abort", () => {
        audio.pause();
        STATE.currentAudio = null;
        reject(new Error("aborted"));
      });
      audio.play().catch(reject);
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

      maybeExtendGoogleDocsSegments(i);
      highlightSentence(segment, spokenText);
      clearWordHighlight();

      if (!isActivePlayRequest(requestId)) break;

      if (STATE.settings.provider === "edge") {
        prefetchEdgeAhead(i, STATE.settings);
      }

      try {
        while (isActivePlayRequest(requestId) && !STATE.paused) {
          try {
            await speakSegment(spokenText, segment);
            break;
          } catch (err) {
            if (err.message !== "aborted" || !isActivePlayRequest(requestId) || STATE.paused) throw err;
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
          clearActiveParagraphButton();
          resetFollowMode();
          scheduleParagraphPlayButtons();
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
      setStatus(t("content.statusComplete"));
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

  let docsScrollRebuildTimer = null;
  window.addEventListener(
    "scroll",
    () => {
      if (!isGoogleDocs() || !STATE.running) return;
      clearTimeout(docsScrollRebuildTimer);
      docsScrollRebuildTimer = setTimeout(() => {
        maybeExtendGoogleDocsSegments(STATE.currentIndex ?? 0);
      }, 350);
    },
    { passive: true, capture: true }
  );

  document.addEventListener("mousedown", (e) => {
    if (e.target.closest(".brave-tts-play-here, .brave-tts-hover-play")) return;
    hidePlayHereButton();
  });

  document.addEventListener("dblclick", (e) => {
    if (!isGoogleDocs()) return;
    if (isSkippableTarget(e.target)) return;
    if (!isInGoogleDocsEditor(e.target)) return;

    const { clientX, clientY } = e;
    setTimeout(async () => {
      if (!buildGoogleDocsSegments()) {
        await new Promise((r) => setTimeout(r, 250));
        if (!buildGoogleDocsSegments()) {
          showGoogleDocsHint(t("content.docsScrollRetry"));
          return;
        }
      }

      let startInfo = resolveGoogleDocsStartFromSelection() ||
        resolveGoogleDocsStartFromPoint(clientX, clientY);
      if (!startInfo) {
        showGoogleDocsHint(t("content.docsDoubleClickText"));
        return;
      }

      if (STATE.running) {
        jumpToStartInfo(startInfo);
        return;
      }

      const stored = await loadStoredSettings();
      requestReading(startInfo, stored, null);
    }, 150);
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "START_READING") {
      startReading(msg.settings);
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === "REFRESH_PARAGRAPH_BUTTONS") {
      scheduleParagraphPlayButtons();
      sendResponse({ ok: true });
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

  removeParagraphPlayButtons();
  if (isGoogleDocs()) {
    ensureDocsA11yStyles();
    tryEnableDocsScreenReader();
    scheduleDocsA11yPoll();
    showGoogleDocsHint();
    setTimeout(showGoogleDocsHint, 4000);
  }
})();

(() => {
  if (window.__braveTtsDocsContentLoaded) return;
  window.__braveTtsDocsContentLoaded = true;

  const api = window.__braveTtsApi;
  const register = window.__braveTtsRegisterDocs;
  if (!api || !register) return;

  const {
    STATE,
    t,
    trimFromWordBoundary,
    normalizeTextNode,
    getCaretFromPoint,
    requestReading,
    jumpToStartInfo,
    loadStoredSettings,
    isSkippableTarget,
    setStatus,
  } = api;

  const DOCS_A11Y_RECT_SELECTOR =
    ".kix-canvas-tile-content svg>g>rect[aria-label], " +
    ".kix-canvas-tile-content svg>g[role=paragraph]>rect[aria-label]";

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

  function isInDocsEditor(el) {
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

  function collectGoogleDocsClosureContent() {
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

  function getDocsHoverTarget(x, y) {
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
    if (!el || !isInDocsEditor(el)) return null;
    return el.closest(".kix-lineview-content, .kix-lineview");
  }

  function getHoverReadingTarget(x, y) {
    const target = getDocsHoverTarget(x, y);
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
        buildSegments();
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

  function resolveReadStartFromSelection() {
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

  function resolveReadStartFromPoint(x, y) {
    if (!STATE.segments.length) buildSegments();

    const startFromSelection = resolveReadStartFromSelection();
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

  function buildSegments() {
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

  function maybeExtendSegments(currentIndex) {
    if (currentIndex < STATE.segments.length - 4) return;
    const prevLength = STATE.segments.length;
    buildSegments();
    if (STATE.segments.length > prevLength) {
      setStatus?.(t("content.statusReading"));
    }
  }

  function resolveReadStartFromElement(el) {
    if (!el || !STATE.segments.length) return null;

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

    return null;
  }

  function findBlockFromTarget(target) {
    return target?.closest?.(".kix-lineview-content, .kix-lineview") ||
      target?.closest?.(DOCS_A11Y_RECT_SELECTOR);
  }

  function getReadableRoot() {
    const editor = getGoogleDocsEditor();
    if (editor && editor.innerText.replace(/\s+/g, " ").trim().length > 10) return editor;
    return null;
  }

  function getSegmentRange(segment, spokenText) {
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

  function highlightSentence(segment, spokenText) {
    if (segment?.lineEl) {
      STATE.lastProgrammaticScrollAt = Date.now();
      segment.lineEl.scrollIntoView({ block: "center", behavior: "auto" });
      return;
    }

    if (STATE.docsClosureMode) {
      const entry = STATE.docsEntries?.find(
        (item) => segment.globalStart >= item.start && segment.globalStart <= item.end
      );
      scrollToDocsClosureEntry(entry);
      return;
    }

    const range = getSegmentRange(segment, spokenText);
    if (range) api.scrollRangeIntoView?.(range);
  }

  function scrollIntoView(range, { force = false } = {}) {
    const el = range.startContainer.nodeType === Node.TEXT_NODE
      ? range.startContainer.parentElement
      : range.startContainer;
    el?.scrollIntoView({ block: "center", behavior: force ? "smooth" : "auto" });
  }

  async function startReadingFromTarget(target, point) {
    if (!target) return;

    if (!buildSegments()) {
      showGoogleDocsHint(t("content.docsNotReady"));
      return;
    }
    let startInfo = resolveReadStartFromElement(target);
    const coords = point || STATE.hoverPointer || STATE.lastPointer;
    if (!startInfo && coords) {
      startInfo = resolveReadStartFromPoint(coords.x, coords.y);
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

  let docsScrollRebuildTimer = null;

  function init() {
    ensureDocsA11yStyles();
    tryEnableDocsScreenReader();
    scheduleDocsA11yPoll();
    showGoogleDocsHint();
    setTimeout(showGoogleDocsHint, 4000);

    window.addEventListener(
      "scroll",
      () => {
        if (!STATE.running) return;
        clearTimeout(docsScrollRebuildTimer);
        docsScrollRebuildTimer = setTimeout(() => {
          maybeExtendSegments(STATE.currentIndex ?? 0);
        }, 350);
      },
      { passive: true, capture: true }
    );

    document.addEventListener("dblclick", (e) => {
      if (isSkippableTarget(e.target)) return;
      if (!isInDocsEditor(e.target)) return;

      const { clientX, clientY } = e;
      setTimeout(async () => {
        if (!buildSegments()) {
          await new Promise((r) => setTimeout(r, 250));
          if (!buildSegments()) {
            showGoogleDocsHint(t("content.docsScrollRetry"));
            return;
          }
        }

        let startInfo = resolveReadStartFromSelection() ||
          resolveReadStartFromPoint(clientX, clientY);
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
  }

  register({
    buildSegments,
    resolveReadStartFromElement,
    resolveReadStartFromPoint,
    resolveReadStartFromSelection,
    findBlockFromTarget,
    getHoverReadingTarget,
    startReadingFromTarget,
    getReadableRoot,
    isInDocsEditor,
    getSegmentRange,
    highlightSentence,
    scrollIntoView,
    maybeExtendSegments,
    init,
  });
})();

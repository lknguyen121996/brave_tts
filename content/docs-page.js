(function () {
  function resolveExtensionId() {
    const current = document.currentScript;
    if (current) {
      const fromDataset = current.dataset?.extId || current.getAttribute("data-ext-id");
      if (fromDataset) return fromDataset;
      if (current.src) {
        try {
          const url = new URL(current.src);
          const fromQuery = url.searchParams.get("extId");
          if (fromQuery) return fromQuery;
          if (url.protocol === "chrome-extension:" && url.host) return url.host;
        } catch {
          /* ignore */
        }
      }
    }
    return null;
  }

  const extId = resolveExtensionId();
  if (extId) {
    try {
      window._docs_annotate_canvas_by_ext = extId;
    } catch {
      /* ignore */
    }
  }

  if (window.__braveTtsDocsPage) return;

  function digClosureText(src, seen) {
    if (!src || seen.has(src)) return null;
    seen.add(src);

    const values = Array.isArray(src) ? src : Object.values(src);
    for (const value of values) {
      try {
        if (!value || Object.prototype.toString.call(value) === "[object Window]" || seen.has(value)) {
          continue;
        }
      } catch {
        continue;
      }

      seen.add(value);
      if (typeof value === "string" && value.charCodeAt(0) === 3 && value.endsWith("\n")) {
        return value.slice(1).replace(/\u200b/g, "");
      }

      if (typeof value === "object") {
        const nested = digClosureText(value, seen);
        if (nested) return nested;
      }
    }

    return null;
  }

  function extractClosureDocsText() {
    try {
      const iframe = document.querySelector("iframe.docs-texteventtarget-iframe");
      const doc = iframe?.contentDocument;
      if (!doc) return null;

      const key = Object.keys(doc).find((k) => k.startsWith("closure_"));
      const root = key ? doc[key] : doc.defaultView;
      return digClosureText(root, new Set());
    } catch {
      return null;
    }
  }

  function countA11yRects() {
    return document.querySelectorAll(
      ".kix-canvas-tile-content svg>g>rect[aria-label], " +
      ".kix-canvas-tile-content svg>g[role=paragraph]>rect[aria-label]"
    ).length;
  }

  window.__braveTtsDocsPage = {
    extractClosureDocsText,
    countA11yRects,
    extId: extId || null,
  };

  window.addEventListener("brave-tts-docs-extract", (event) => {
    window.dispatchEvent(new CustomEvent("brave-tts-docs-text", {
      detail: {
        eventId: event.detail?.eventId,
        text: extractClosureDocsText(),
        a11yRects: countA11yRects(),
        annotateFlag: window._docs_annotate_canvas_by_ext || null,
      },
    }));
  });
})();

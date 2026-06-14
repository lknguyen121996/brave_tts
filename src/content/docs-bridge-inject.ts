// ============================================================
// Docs Bridge Bootstrap — Google Docs Page-Context Injection
// ============================================================
//
// Injected at document_start on docs.google.com.
// Inserts a <script> tag into the page context that:
//   1. Sets window._docs_annotate_canvas_by_ext (allows canvas annotation)
//   2. Exposes Closure text extraction from the hidden iframe
//   3. Counts a11y rects for diagnostic purposes
//   4. Listens for brave-tts-docs-extract → responds brave-tts-docs-text
//
// Must run in page context (not content script isolated world)
// because it accesses _docs_annotate_canvas_by_ext (Google Docs
// internal) and the hidden iframe's closure_* properties.
//
// See: DECISIONS.md § "Google Docs via DocsAdapter"
// ============================================================

// ---- Double-injection guard ----

if (document.querySelector("script[data-brave-tts-docs-bridge]")) {
  // Already injected (e.g., extension reload)
} else {
  injectBridge();
}

// Listen for DOM content changes — if the bridge script gets removed
// (e.g., SPA navigation within Docs), re-inject on next idle moment.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    if (!document.querySelector("script[data-brave-tts-docs-bridge]")) {
      injectBridge();
    }
  }, { once: true });
}

// ---- Injection ----

function injectBridge(): void {
  if (typeof chrome === "undefined" || !chrome.runtime?.id) return;

  const script = document.createElement("script");
  script.dataset.braveTtsDocsBridge = "1";
  script.dataset.extId = chrome.runtime.id;
  script.async = false;
  script.textContent = BRIDGE_CODE;

  (document.documentElement || document.head || document).appendChild(script);
}

// ---- Page-Context Bridge Code ----
//
// This string is injected as the textContent of a <script> tag.
// It runs in the page's world, NOT the content script's isolated world.
// Keep it self-contained — no imports, no TypeScript, no closure over
// the content script's scope.

const BRIDGE_CODE = `
(function () {
  if (window.__braveTtsDocsBridge) return;

  var currentScript = document.currentScript;
  var extId = currentScript && currentScript.dataset && currentScript.dataset.extId
    ? currentScript.dataset.extId
    : null;

  // ---- Annotate Canvas ----
  // Signal to Google Docs that this extension is allowed to annotate the canvas.
  // Must be set BEFORE Google Docs' internal JS initializes.
  if (extId) {
    try {
      window._docs_annotate_canvas_by_ext = extId;
    } catch (e) { /* ignore */ }
  }

  // ---- Closure Text Extraction ----
  // Google Docs stores the document text in a hidden iframe
  // (iframe.docs-texteventtarget-iframe) as Closure-compiled properties.

  function digClosureText(src, seen) {
    if (!src || seen.has(src)) return null;
    seen.add(src);

    var values = Array.isArray(src) ? src : Object.values(src);
    for (var i = 0; i < values.length; i++) {
      var value = values[i];
      try {
        if (!value || Object.prototype.toString.call(value) === "[object Window]" || seen.has(value)) {
          continue;
        }
      } catch (e) {
        continue;
      }

      seen.add(value);
      if (typeof value === "string" && value.charCodeAt(0) === 3 && value.endsWith("\\n")) {
        return value.slice(1).replace(/\\u200b/g, "");
      }

      if (typeof value === "object") {
        var nested = digClosureText(value, seen);
        if (nested) return nested;
      }
    }

    return null;
  }

  function extractClosureDocsText() {
    try {
      var iframe = document.querySelector("iframe.docs-texteventtarget-iframe");
      var doc = iframe && iframe.contentDocument;
      if (!doc) return null;

      var key = Object.keys(doc).find(function (k) { return k.indexOf("closure_") === 0; });
      var root = key ? doc[key] : doc.defaultView;
      return digClosureText(root, new Set());
    } catch (e) {
      return null;
    }
  }

  function countA11yRects() {
    return document.querySelectorAll(
      ".kix-canvas-tile-content svg>g>rect[aria-label], " +
      ".kix-canvas-tile-content svg>g[role=paragraph]>rect[aria-label]"
    ).length;
  }

  // ---- Public API ----

  window.__braveTtsDocsBridge = {
    extractClosureDocsText: extractClosureDocsText,
    countA11yRects: countA11yRects,
    extId: extId || null,
  };

  // ---- Event: Extract Request → Response ----

  window.addEventListener("brave-tts-docs-extract", function (event) {
    window.dispatchEvent(new CustomEvent("brave-tts-docs-text", {
      detail: {
        eventId: event.detail && event.detail.eventId,
        text: extractClosureDocsText(),
        a11yRects: countA11yRects(),
        annotateFlag: window._docs_annotate_canvas_by_ext || null,
      },
    }));
  });
})();
`;

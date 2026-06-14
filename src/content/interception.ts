// ============================================================
// Interception Content Script — V2-03 Tier 2+3
// ============================================================
//
// Lightweight content script (NO React, NO Shadow DOM) —
// runs in ALL frames at document_start. Performs:
//
//   1. Detect file:// URLs and redirect to viewer
//   2. Detect <embed>/<object>/<iframe> with PDF/EPUB sources
//      via MutationObserver + initial DOM scan
//   3. Intercept <a> clicks to PDF/EPUB URLs
//
// Weight: minimal — designed for `all_frames: true` performance.
//
// See: DECISIONS.md § "Hybrid Interception"

import {
  detectDocumentType,
  buildViewerUrl,
  type DocumentType,
} from "@shared/interception";

// ---- Constants ----

/** CSS selector for elements that may embed PDF/EPUB content */
const EMBED_SELECTOR =
  "embed[src], object[data], iframe[src]";

/** Protocol prefixes used for routing decisions */
const FILE_PROTOCOL = "file:";
const EXTENSION_PROTOCOL = "chrome-extension:";

// ---- Helpers ----

/**
 * Get the document source URL from an embed-like element.
 * Handles <embed src>, <object data>, and <iframe src>.
 */
function getElementSource(el: Element): string | null {
  if (el instanceof HTMLIFrameElement) {
    return el.src || null;
  }
  if (el instanceof HTMLEmbedElement) {
    return el.src || null;
  }
  if (el instanceof HTMLObjectElement) {
    return el.data || null;
  }
  return null;
}

// ---- Redirect ----

/**
 * Navigate the current frame to the viewer page for the given
 * document URL. Uses `window.location.href` assignment for
 * synchronous navigation that stops all further page loading.
 */
function redirectToViewer(url: string, docType: DocumentType): void {
  const viewerUrl = buildViewerUrl(url, docType);
  console.debug(
    "[Brave Read Aloud] Redirecting to viewer:",
    { from: url, to: viewerUrl, type: docType }
  );
  window.location.href = viewerUrl;
}

// ---- Tier 2: Current URL Check ----

/**
 * Check if the current page URL itself points to a PDF/EPUB
 * document. Catches cases where the DNR rule did NOT fire
 * (e.g., file://, DNR unavailable, or sub-frame navigation).
 */
function checkCurrentUrl(): void {
  const url = window.location.href;

  // Don't redirect if we're already on a viewer page (infinite loop guard)
  if (url.startsWith(EXTENSION_PROTOCOL + "://")) return;

  // Don't redirect if extension context is invalid
  if (typeof chrome === "undefined" || !chrome.runtime?.id) return;

  const docType = detectDocumentType(url);
  if (docType) {
    redirectToViewer(url, docType);
  }
}

// ---- Tier 3: file:// Detection ----

/**
 * Handle navigation to a file:// URL.
 *
 * If the URL is a PDF/EPUB document:
 *   - Redirect to viewer (the viewer will show "coming soon" and
 *     an onboarding prompt if file:// access is not granted).
 *
 * If the URL is a file:// but NOT a document:
 *   - Notify SW via fire-and-forget message (for popup onboarding UI)
 */
function handleFileUrl(): void {
  const url = window.location.href;
  const docType = detectDocumentType(url);

  if (docType) {
    // Redirect to viewer — it will handle the file:// permissions check
    redirectToViewer(url, docType);
    return;
  }

  // Not a document — notify SW that we're on a file:// page
  notifyFileUrlDetected(url);
}

/** Fire-and-forget notification to SW */
function notifyFileUrlDetected(url: string): void {
  try {
    chrome.runtime.sendMessage({
      type: "FILE_URL_DETECTED",
      url,
    } satisfies import("@shared/types").FileUrlDetectedMessage).catch(() => {
      // SW may not be running — that's fine
    });
  } catch {
    // Extension context may be invalidated
  }
}

// ---- MutationObserver (Tier 2) ----

/**
 * Check a single element: if it embeds a PDF/EPUB source,
 * redirect to the viewer. Called for each <embed>/<object>/<iframe>
 * detected in the DOM.
 */
function checkElement(el: Element): void {
  const src = getElementSource(el);
  if (!src || src.trim() === "") return;

  const docType = detectDocumentType(src);
  if (docType) {
    redirectToViewer(src, docType);
  }
}

/**
 * Set up a MutationObserver on `document.documentElement` to
 * detect dynamically-inserted embed/object/iframe elements.
 */
function setupMutationObserver(): void {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        // Direct match: the added node itself is an embed element
        if (node instanceof Element && node.matches(EMBED_SELECTOR)) {
          checkElement(node);
        }
        // Sub-tree match: the added node contains embed elements
        if (node instanceof Element) {
          const children = node.querySelectorAll(EMBED_SELECTOR);
          for (const child of children) {
            checkElement(child);
          }
        }
      }
    }
  });

  // Use document.documentElement — available at document_start
  const root = document.documentElement;
  if (root) {
    observer.observe(root, { childList: true, subtree: true });
  }
}

/** Scan existing DOM for embed elements that may be present
 * before the MutationObserver was set up. */
function checkExistingElements(): void {
  const elements = document.querySelectorAll(EMBED_SELECTOR);
  for (const el of elements) {
    checkElement(el);
  }
}

// ---- Link Click Interception (Tier 2) ----

/**
 * Intercept clicks on <a> elements pointing to PDF/EPUB URLs.
 * Uses `capture: true` to handle the event before the browser
 * navigates. Only intercepts primary button clicks (not middle-
 * click, ctrl+click, etc.).
 */
function handleLinkClick(event: MouseEvent): void {
  // Only primary button (left click), no modifier keys
  if (event.button !== 0) return;
  if (event.ctrlKey || event.metaKey || event.shiftKey) return;

  // Find the nearest anchor element
  const link = (event.target as Element).closest("a[href]");
  if (!(link instanceof HTMLAnchorElement)) return;
  if (!link.href) return;

  const docType = detectDocumentType(link.href);
  if (!docType) return;

  // Intercept: prevent browser navigation, redirect to viewer
  event.preventDefault();
  event.stopPropagation();
  redirectToViewer(link.href, docType);
}

// ---- Initialization ----

/**
 * Entry point — called once when the content script loads
 * (at document_start, in every frame).
 *
 * Guard clauses ensure no work is done on viewer pages
 * (prevents infinite redirect loops).
 */
export function initInterception(): void {
  const url = window.location.href;

  // Guard: we're on a viewer page — do nothing
  if (
    url.includes("/src/pages/pdf-viewer/") ||
    url.includes("/src/pages/epub-viewer/")
  ) {
    return;
  }

  // Tier 3: file:// protocol handling
  if (url.startsWith(FILE_PROTOCOL + "//")) {
    handleFileUrl();
    return; // file:// pages won't have embed/object content
  }

  // Tier 2: Check if the current URL itself is a document
  // (fallback for when DNR doesn't catch the navigation)
  checkCurrentUrl();

  // Tier 2: Observe dynamically inserted embed elements
  setupMutationObserver();
  if (document.readyState !== "loading") {
    checkExistingElements();
  } else {
    document.addEventListener(
      "DOMContentLoaded",
      checkExistingElements,
      { once: true }
    );
  }

  // Tier 2: Intercept link clicks to documents
  document.addEventListener("click", handleLinkClick, { capture: true });
}

// Self-invoke on load
initInterception();

// ============================================================
// Interception Constants & Utilities — V2-03
// ============================================================
//
// Shared helpers for PDF/EPUB URL detection, viewer URL
// construction, and DNR rule management. Used by both
// the Service Worker (DNR rules) and Content Scripts
// (MutationObserver + link interception).
//
// See: DECISIONS.md § "Hybrid Interception"

// ---- Document Extension Maps ----
export const PDF_EXTENSIONS = [".pdf"] as const;
export const EPUB_EXTENSIONS = [".epub"] as const;

/** All supported document extensions (flat array for iteration) */
export const ALL_DOC_EXTENSIONS: readonly string[] = [
  ...PDF_EXTENSIONS,
  ...EPUB_EXTENSIONS,
];

// ---- Document Type ----
export type DocumentType = "pdf" | "epub";

const EXTENSION_TO_TYPE: Record<string, DocumentType> = {
  ".pdf": "pdf",
  ".epub": "epub",
};

/**
 * Detect document type from a URL string by file extension.
 * Returns null if the URL does not point to a supported document.
 * Case-insensitive matching.
 */
export function detectDocumentType(url: string): DocumentType | null {
  // Try URL API first (works for valid HTTP/S URLs)
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    for (const [ext, type] of Object.entries(EXTENSION_TO_TYPE)) {
      if (pathname.endsWith(ext)) return type;
    }
  } catch {
    // Invalid URL (e.g., file:// with spaces or special chars)
    // Fall through to string search below
  }

  // Fallback: simple substring search for edge cases
  // where URL parsing fails (file:// paths, about:blank?src=...)
  const lower = url.toLowerCase();
  for (const [ext, type] of Object.entries(EXTENSION_TO_TYPE)) {
    if (lower.includes(ext)) return type;
  }
  return null;
}

// ---- Viewer Page URL Construction ----

/** Internal viewer page paths (relative to extension root) */
const VIEWER_PATHS: Record<DocumentType, string> = {
  pdf: "src/pages/pdf-viewer/index.html",
  epub: "src/pages/epub-viewer/index.html",
};

/** Prefix used in URL hash to pass the original document URL */
const INTERCEPTION_HASH_PREFIX = "#url=";

/**
 * Build the extension viewer URL for a given document URL and type.
 *
 * The original URL is embedded in the hash fragment (`#url=...`)
 * rather than the query string. Hash fragments are client-side
 * only and preserve special characters (`&`, `?`, `#`) in the
 * original URL without parsing conflicts.
 *
 * Used by DNR `regexSubstitution` rules (SW) and content script
 * redirect logic.
 */
export function buildViewerUrl(
  documentUrl: string,
  docType: DocumentType
): string {
  const viewerPath = VIEWER_PATHS[docType];
  const viewerBase = chrome.runtime.getURL(viewerPath);
  return `${viewerBase}${INTERCEPTION_HASH_PREFIX}${documentUrl}`;
}

/**
 * Extract the original document URL from a viewer page URL.
 *
 * Primary: reads the `#url=...` hash fragment (set by DNR or
 * content script redirects).
 * Fallback: reads the `?url=...` query param (for manual
 * navigation or test scenarios).
 *
 * Returns empty string if no URL is found.
 */
export function extractOriginalUrl(): string {
  // Primary: hash fragment (set by DNR redirects)
  const hash = window.location.hash;
  if (hash.startsWith(INTERCEPTION_HASH_PREFIX)) {
    return hash.slice(INTERCEPTION_HASH_PREFIX.length);
  }

  // Fallback: query param (set by direct navigation or tests)
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get("url");
  if (fromQuery) return fromQuery;

  return "";
}

// ---- DNR Rule IDs ----
// Use 1000+ range to avoid collision with V1 Edge TTS rules
// (which use 9001+).

export const DNR_RULE_IDS = {
  PDF_REDIRECT: 1001,
  EPUB_REDIRECT: 1002,
} as const;

export const ALL_DNR_RULE_IDS: readonly number[] = Object.values(DNR_RULE_IDS);

// ============================================================
// EPUB Viewer Page — Brave Read Aloud V2
// ============================================================
//
// Receives the EPUB URL via hash (`#url=...`) or query param
// (`?url=...`). Loads the book via epub.js, renders it in the
// page, and integrates with EPUBAdapter for text extraction
// and highlight.
//
// 5 states: loading → ready → reading (TTS active)
//                     → error (no URL, fetch failed, etc.)
//                     → unsupported (not an EPUB URL)
//
// See DECISIONS.md § "EPUB dùng rendition events trực tiếp"

import React, { useEffect, useState, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { extractOriginalUrl, detectDocumentType } from "@shared/interception";
import { EPUBAdapter } from "@adapters/EPUBAdapter";

// epub.js default export is the ePub function
import ePub from "epubjs";
import type { Book, Rendition, Contents } from "epubjs";

// ---- Types ----

type ViewerState = "loading" | "ready" | "reading" | "error" | "unsupported";

interface ViewerLocation {
  cfi: string;
  chapter: string;
  page: number;
  totalPages: number;
  percentage: number;
}

// ---- Styles ----

const styles: Record<string, React.CSSProperties> = {
  toolbar: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 16px",
    background: "#1a1a2e",
    color: "#fff",
    fontSize: 13,
    fontFamily: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`,
  },
  toolbarTitle: {
    flex: 1,
    fontWeight: 600,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  toolbarBtn: {
    padding: "6px 12px",
    border: "1px solid rgba(255,255,255,0.2)",
    borderRadius: 6,
    background: "rgba(255,255,255,0.1)",
    color: "#fff",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 500,
  },
  toolbarBtnPrimary: {
    padding: "6px 14px",
    border: "none",
    borderRadius: 6,
    background: "#4361ee",
    color: "#fff",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 600,
  },
  container: {
    marginTop: 44,
    flex: 1,
    background: "#fff",
    minHeight: "calc(100vh - 44px)",
  },
  center: {
    marginTop: 80,
    flex: 1,
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    padding: 40,
    textAlign: "center" as const,
    color: "#ccc",
    fontFamily: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`,
  },
  location: {
    fontSize: 12,
    opacity: 0.8,
    minWidth: 100,
    textAlign: "right" as const,
  },
};

// ---- Component ----

function EpubViewerApp(): React.ReactElement {
  const [state, setState] = useState<ViewerState>("loading");
  const [documentUrl, setDocumentUrl] = useState("");
  const [bookTitle, setBookTitle] = useState("EPUB Viewer");
  const [location, setLocation] = useState<ViewerLocation | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  const containerRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const adapterRef = useRef<EPUBAdapter>(new EPUBAdapter());

  // ---- Initialize book ----

  useEffect(() => {
    const url = extractOriginalUrl();

    if (!url) {
      setState("error");
      setErrorMessage(
        "No document URL provided. Use #url=<epub_url> in the address."
      );
      return;
    }

    const docType = detectDocumentType(url);
    if (docType !== "epub") {
      setState("unsupported");
      return;
    }

    setDocumentUrl(url);
    initBook(url);

    return () => {
      // Cleanup
      renditionRef.current?.destroy();
      bookRef.current?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function initBook(url: string): Promise<void> {
    try {
      const book = ePub(url);
      bookRef.current = book;

      // Wait for book to open
      await book.opened;

      // Get metadata
      const metadata = await book.loaded.metadata;
      const title = (metadata as unknown as Record<string, unknown>)?.title as string | undefined;
      if (title) setBookTitle(title);

      // Render to container
      if (!containerRef.current) return;

      const rendition = book.renderTo(containerRef.current, {
        width: "100%",
        height: "100%",
        flow: "paginated",
        spread: "auto",
        minSpreadWidth: 800,
      });

      renditionRef.current = rendition;

      // Hook: on each chapter render, update the adapter
      rendition.hooks?.render?.register((contents: Contents) => {
        adapterRef.current.setContents({
          document: contents.document,
          addStylesheetCss: contents.addStylesheetCss
            ? (css: string, key: string) => contents.addStylesheetCss(css, key)
            : undefined,
        });
      });

      // Hook: on chapter transition, update location
      rendition.on("relocated", (loc: unknown) => {
        const locData = loc as {
          start?: { cfi?: string; href?: string; location?: number; displayed?: { page: number; total: number }; percentage?: number };
        };
        setLocation({
          cfi: locData?.start?.cfi || "",
          chapter: locData?.start?.href || "",
          page: locData?.start?.displayed?.page || 0,
          totalPages: locData?.start?.displayed?.total || 0,
          percentage: Math.round((locData?.start?.percentage || 0) * 100),
        });

        // Re-extract text for the new chapter
        const contents = rendition.getContents();
        if (contents) {
          adapterRef.current.setContents({
            document: contents.document,
            addStylesheetCss: contents.addStylesheetCss
              ? (css: string, key: string) => contents.addStylesheetCss(css, key)
              : undefined,
          });
          adapterRef.current.extract();
        }
      });

      // Start rendering
      await rendition.display();

      // Extract text from first chapter
      const contents = rendition.getContents();
      if (contents) {
        adapterRef.current.setContents({
          document: contents.document,
          addStylesheetCss: contents.addStylesheetCss
            ? (css: string, key: string) => contents.addStylesheetCss(css, key)
            : undefined,
        });
        adapterRef.current.extract();
      }

      setState("ready");
    } catch (err) {
      console.error("[Brave Read Aloud] EPUB load error:", err);
      setState("error");
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to load EPUB document"
      );
    }
  }

  // ---- Navigation ----

  const handlePrev = useCallback(() => {
    renditionRef.current?.prev();
  }, []);

  const handleNext = useCallback(() => {
    renditionRef.current?.next();
  }, []);

  // ---- TTS Controls (stub — wired in v2-09) ----

  const handlePlay = useCallback(() => {
    if (!adapterRef.current) return;
    const output = adapterRef.current.extract();
    setState("reading");
    console.debug("[Brave Read Aloud] EPUB TTS start:", {
      nodes: output.nodes.length,
      length: output.fullText.length,
    });
    // v2-09: send TTS_SPEAK to SW with the extracted text
  }, []);

  const handleStop = useCallback(() => {
    setState("ready");
    adapterRef.current.clearHighlight();
    // v2-09: send TTS_STOP to SW
  }, []);

  // ---- Render ----

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      {/* Toolbar */}
      <div style={styles.toolbar}>
        <span style={styles.toolbarTitle}>{bookTitle}</span>

        {state === "ready" && (
          <>
            <button style={styles.toolbarBtn} onClick={handlePrev} title="Previous chapter">
              ◀ Prev
            </button>
            <span style={styles.location}>
              {location ? `Ch. ${location.page}/${location.totalPages}` : ""}
            </span>
            <button style={styles.toolbarBtn} onClick={handleNext} title="Next chapter">
              Next ▶
            </button>
          </>
        )}

        {/* TTS Buttons */}
        {state === "ready" && (
          <button style={styles.toolbarBtnPrimary} onClick={handlePlay}>
            ▶ Đọc
          </button>
        )}
        {state === "reading" && (
          <button
            style={{ ...styles.toolbarBtnPrimary, background: "#d93025" }}
            onClick={handleStop}
          >
            ■ Dừng
          </button>
        )}
      </div>

      {/* EPUB Render Container */}
      <div ref={containerRef} style={styles.container} />

      {/* Overlay states */}
      {state === "loading" && (
        <div style={styles.center}>
          <div style={{ fontSize: 18, marginBottom: 8 }}>Loading EPUB...</div>
          <div style={{ fontSize: 13, opacity: 0.6 }}>
            {documentUrl ? decodeURIComponent(documentUrl) : "Opening document"}
          </div>
        </div>
      )}

      {state === "error" && (
        <div style={styles.center}>
          <div style={{ fontSize: 18, color: "#ff6b6b", marginBottom: 8 }}>
            Could not load EPUB
          </div>
          <div style={{ fontSize: 13, opacity: 0.6, maxWidth: 400 }}>
            {errorMessage}
          </div>
        </div>
      )}

      {state === "unsupported" && (
        <div style={styles.center}>
          <div style={{ fontSize: 18, color: "#ffd43b", marginBottom: 8 }}>
            Unsupported Document Type
          </div>
          <div style={{ fontSize: 13, opacity: 0.6 }}>
            The URL does not point to an EPUB document.
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Mount ----

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<EpubViewerApp />);
} else {
  console.error("[Brave Read Aloud] EPUB viewer: #root not found");
}

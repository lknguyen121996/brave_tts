// ============================================================
// PDF Viewer Page — Brave Read Aloud V2
// ============================================================
//
// Receives the PDF URL via hash (`#url=...`) or query param
// (`?url=...`). Loads PDF.js dynamically, renders each page
// as canvas + textLayer, and integrates with PDFAdapter for
// text extraction and highlight.
//
// 5 states: loading → rendering → ready → reading (TTS active)
//                     → error (no URL, load failed, etc.)
//                     → unsupported (not a PDF URL)
//
// See DECISIONS.md § "PDF text sort mượn từ PDF.js source"

import React, {
  useEffect,
  useState,
  useRef,
  useCallback,
} from "react";
import { createRoot } from "react-dom/client";
import { extractOriginalUrl, detectDocumentType } from "@shared/interception";
import { PDFAdapter } from "@adapters/PDFAdapter";

// ---- Types ----

type ViewerState =
  | "loading"
  | "rendering"
  | "ready"
  | "reading"
  | "error"
  | "unsupported";

interface PageInfo {
  current: number;
  total: number;
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
  viewerContainer: {
    marginTop: 44,
    flex: 1,
    overflowY: "auto" as const,
    padding: "16px 0",
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
  pageInfo: {
    fontSize: 12,
    opacity: 0.8,
    minWidth: 80,
    textAlign: "right" as const,
  },
  progressBar: {
    width: 200,
    height: 6,
    background: "rgba(255,255,255,0.1)",
    borderRadius: 3,
    overflow: "hidden",
    marginTop: 12,
  },
  progressFill: {
    height: "100%",
    background: "#4361ee",
    borderRadius: 3,
    transition: "width 0.2s",
  },
};

// ---- Constants ----

const SCALE = 1.5;

// ---- Component ----

function PdfViewerApp(): React.ReactElement {
  const [state, setState] = useState<ViewerState>("loading");
  const [documentUrl, setDocumentUrl] = useState("");
  const [filename, setFilename] = useState("PDF Viewer");
  const [pageInfo, setPageInfo] = useState<PageInfo>({ current: 0, total: 0 });
  const [renderProgress, setRenderProgress] = useState(0); // 0-100
  const [totalSegments, setTotalSegments] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");

  const viewerRef = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<PDFAdapter>(new PDFAdapter());

  // ---- Init: load PDF.js and render ----

  useEffect(() => {
    const url = extractOriginalUrl();

    if (!url) {
      setState("error");
      setErrorMessage(
        "No document URL provided. Use #url=<pdf_url> in the address."
      );
      return;
    }

    const docType = detectDocumentType(url);
    if (docType !== "pdf") {
      setState("unsupported");
      return;
    }

    setDocumentUrl(url);

    // Extract filename from URL
    try {
      const pathname = new URL(url).pathname;
      const name = pathname.split("/").pop() || "document.pdf";
      setFilename(decodeURIComponent(name));
    } catch {
      setFilename("document.pdf");
    }

    loadPdfJs()
      .then(() => renderAllPages(url))
      .catch((err) => {
        console.error("[Brave Read Aloud] PDF init error:", err);
        setState("error");
        setErrorMessage(
          err instanceof Error ? err.message : "Failed to load PDF viewer"
        );
      });

    return () => {
      adapterRef.current.clearPages();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Dynamic PDF.js loading ----

  function loadPdfJs(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = chrome.runtime.getURL("pdf-reader/pdf.min.js");
      script.onload = () => {
        pdfjsLib.GlobalWorkerOptions.workerSrc =
          chrome.runtime.getURL("pdf-reader/pdf.worker.min.js");
        resolve();
      };
      script.onerror = () =>
        reject(new Error("Failed to load PDF.js library"));
      document.head.appendChild(script);
    });
  }

  // ---- Render all pages sequentially ----

  async function renderAllPages(url: string): Promise<void> {
    setState("rendering");

    const loadingTask = pdfjsLib.getDocument({ url });
    const pdfDoc = await loadingTask.promise;

    const totalPages = pdfDoc.numPages;
    if (totalPages === 0) {
      setState("error");
      setErrorMessage("PDF has no pages");
      return;
    }

    setPageInfo({ current: 0, total: totalPages });

    // Clear previous render
    adapterRef.current.clearPages();
    if (viewerRef.current) viewerRef.current.innerHTML = "";

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      try {
        await renderPage(pdfDoc, pageNum);
        setRenderProgress(Math.round((pageNum / totalPages) * 100));
        setPageInfo({ current: pageNum, total: totalPages });
      } catch (err) {
        console.error(
          `[Brave Read Aloud] Error rendering page ${pageNum}:`,
          err
        );
        // Continue with remaining pages
      }
    }

    // Extract text from all rendered pages
    try {
      const nodes = adapterRef.current.extractNodes();
      setTotalSegments(nodes.length);
      console.debug(
        `[Brave Read Aloud] PDF extracted: ${nodes.length} segments across ${totalPages} pages`
      );
    } catch (err) {
      console.error("[Brave Read Aloud] PDF extraction error:", err);
    }

    setState("ready");
  }

  async function renderPage(
    pdfDoc: pdfjsLib.PDFDocumentProxy,
    pageNum: number
  ): Promise<void> {
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: SCALE });

    // Create page container
    const container = document.createElement("div");
    container.className = "page-container";
    container.style.width = `${viewport.width}px`;
    container.style.height = `${viewport.height}px`;

    // Canvas for pixel rendering
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    container.appendChild(canvas);

    // Text layer for text selection and TTS
    const textLayer = document.createElement("div");
    textLayer.className = "textLayer";
    textLayer.style.width = `${viewport.width}px`;
    textLayer.style.height = `${viewport.height}px`;
    container.appendChild(textLayer);

    // Append to viewer
    viewerRef.current?.appendChild(container);

    // Render canvas
    const ctx = canvas.getContext("2d");
    if (ctx) {
      await page.render({ canvasContext: ctx, viewport }).promise;
    }

    // Render text layer
    const textContent = await page.getTextContent();
    const textDivs: HTMLSpanElement[] = [];

    const textLayerTask = pdfjsLib.renderTextLayer({
      textContentSource: textContent,
      container: textLayer,
      viewport,
      textDivs,
    });
    await textLayerTask.promise;

    // Convert generic HTMLElement[] to HTMLSpanElement[]
    const spans = textDivs.filter(
      (el): el is HTMLSpanElement => el instanceof HTMLSpanElement
    );

    // Feed to adapter
    adapterRef.current.setPageData(spans, viewport.width, viewport.height);
  }

  // ---- Navigation ----

  const handlePrev = useCallback(() => {
    if (!viewerRef.current) return;
    const containers = viewerRef.current.querySelectorAll(".page-container");
    const mid = viewerRef.current.scrollTop;
    for (let i = containers.length - 1; i >= 0; i--) {
      const c = containers[i] as HTMLElement;
      if (c.offsetTop < mid - 10) {
        c.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
    }
    // Fallback: scroll to top
    containers[0]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const handleNext = useCallback(() => {
    if (!viewerRef.current) return;
    const containers = viewerRef.current.querySelectorAll(".page-container");
    const mid = viewerRef.current.scrollTop;
    for (let i = 0; i < containers.length; i++) {
      const c = containers[i] as HTMLElement;
      if (c.offsetTop + c.offsetHeight > mid + 10) {
        c.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
    }
  }, []);

  // ---- TTS placeholder (v2-09 integration point) ----

  const handleReadFromHere = useCallback(() => {
    // v2-09: send START_READING with adapter data to content script → SW
    const output = adapterRef.current.extract();
    console.debug("[Brave Read Aloud] PDF ready for TTS:", {
      segments: output.nodes.length,
      fullTextLength: output.fullText.length,
    });
  }, []);

  // ---- Scroll-based page tracking ----

  useEffect(() => {
    if (state !== "ready" && state !== "reading") return;

    const viewer = viewerRef.current;
    if (!viewer) return;
    // Capture in a non-nullable local for closure safety
    const viewEl: HTMLDivElement = viewer;

    let ticking = false;
    function onScroll(): void {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const containers = viewEl.querySelectorAll(".page-container");
        const mid = viewEl.scrollTop + viewEl.clientHeight / 2;
        for (let i = 0; i < containers.length; i++) {
          const c = containers[i] as HTMLElement;
          if (
            c.offsetTop <= mid &&
            c.offsetTop + c.offsetHeight >= mid
          ) {
            setPageInfo((prev) => ({ ...prev, current: i + 1 }));
            break;
          }
        }
        ticking = false;
      });
    }

    viewEl.addEventListener("scroll", onScroll, { passive: true });
    return () => viewEl.removeEventListener("scroll", onScroll);
  }, [state]);

  // ---- Keyboard navigation ----

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") handlePrev();
      else if (e.key === "ArrowRight" || e.key === "ArrowDown") handleNext();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handlePrev, handleNext]);

  // ---- Render ----

  return (
    <div>
      {/* Toolbar */}
      <div style={styles.toolbar}>
        <span style={styles.toolbarTitle}>{filename}</span>
        {state === "rendering" && (
          <span style={{ fontSize: 12, opacity: 0.7 }}>
            Rendering page {pageInfo.current}/{pageInfo.total}…
          </span>
        )}
        {(state === "ready" || state === "reading") && (
          <>
            <button
              style={styles.toolbarBtn}
              onClick={handlePrev}
              title="Previous page"
            >
              ◀
            </button>
            <span style={styles.pageInfo}>
              {pageInfo.current} / {pageInfo.total}
            </span>
            <button
              style={styles.toolbarBtn}
              onClick={handleNext}
              title="Next page"
            >
              ▶
            </button>
            <button
              style={styles.toolbarBtnPrimary}
              onClick={handleReadFromHere}
              title="Read from beginning"
            >
              ▶ Read Aloud
            </button>
          </>
        )}
      </div>

      {/* Viewer container */}
      <div ref={viewerRef} style={styles.viewerContainer} />

      {/* Overlay states */}
      {state !== "ready" && state !== "reading" && (
        <div style={styles.center}>
          {state === "loading" && (
            <>
              <div style={{ fontSize: 18, marginBottom: 8 }}>
                Loading PDF…
              </div>
              <div style={{ fontSize: 13, opacity: 0.6 }}>
                Fetching document
              </div>
            </>
          )}

          {state === "rendering" && (
            <>
              <div style={{ fontSize: 18, marginBottom: 8 }}>
                Rendering pages…
              </div>
              <div style={styles.progressBar}>
                <div
                  style={{ ...styles.progressFill, width: `${renderProgress}%` }}
                />
              </div>
              <div style={{ fontSize: 12, opacity: 0.5, marginTop: 8 }}>
                {renderProgress}%
              </div>
            </>
          )}

          {state === "error" && (
            <>
              <div style={{ fontSize: 18, color: "#ff6b6b", marginBottom: 8 }}>
                Could not load PDF
              </div>
              <div style={{ fontSize: 13, opacity: 0.6, maxWidth: 500 }}>
                {errorMessage}
              </div>
            </>
          )}

          {state === "unsupported" && (
            <>
              <div style={{ fontSize: 18, color: "#ffd43b", marginBottom: 8 }}>
                Unsupported Document Type
              </div>
              <div style={{ fontSize: 13, opacity: 0.6 }}>
                The provided URL does not point to a PDF document.
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---- Mount ----

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<PdfViewerApp />);
} else {
  console.error("[Brave Read Aloud] PDF viewer: #root element not found");
}

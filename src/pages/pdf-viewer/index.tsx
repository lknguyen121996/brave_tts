// ============================================================
// PDF Viewer Page — Brave Read Aloud V2 (Pro Overlay)
// ============================================================
//
// Receives the PDF URL via hash (`#url=...`) or query param
// (`?url=...`). Loads PDF.js dynamically, parses pages in
// batches via requestIdleCallback, renders each page as
// canvas + overlay, and integrates with PDFAdapter for
// word-level text extraction and hybrid highlight.
//
// Virtualisation: react-virtuoso for paginated rendering
// (3 pages in DOM at any time). Container uses
// transform: scale() to lock viewport dimensions.
//
// 5 states: loading → rendering → ready → reading (TTS active)
//                     → error / unsupported
//
// See DECISIONS.md § "PDF Pro Overlay"

import React, { useEffect, useState, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { extractOriginalUrl, detectDocumentType } from "@shared/interception";
import { PDFAdapter } from "@adapters/PDFAdapter";
import { Virtuoso } from "react-virtuoso";

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

// ---- Constants ----

const SCALE = 1.5;
const BATCH_SIZE = 5; // Parse 5 pages per batch

// ---- Styles ----

const S: Record<string, React.CSSProperties> = {
  toolbar: {
    position: "fixed", top: 0, left: 0, right: 0, zIndex: 100,
    display: "flex", alignItems: "center", gap: 10,
    padding: "8px 16px", background: "#1a1a2e", color: "#fff",
    fontSize: 13,
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif",
  },
  toolbarTitle: {
    flex: 1, fontWeight: 600, overflow: "hidden",
    textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  btn: {
    padding: "6px 12px", border: "1px solid rgba(255,255,255,0.2)",
    borderRadius: 6, background: "rgba(255,255,255,0.1)",
    color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 500,
  },
  btnPrimary: {
    padding: "6px 14px", border: "none", borderRadius: 6,
    background: "#4361ee", color: "#fff", cursor: "pointer",
    fontSize: 13, fontWeight: 600,
  },
  pageInfo: { fontSize: 12, opacity: 0.8, minWidth: 80, textAlign: "right" },
  center: {
    marginTop: 80, flex: 1, display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center", padding: 40,
    textAlign: "center", color: "#ccc",
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif",
  },
};

// ---- Component ----

function PdfViewerApp(): React.ReactElement {
  const [state, setState] = useState<ViewerState>("loading");
  const [documentUrl, setDocumentUrl] = useState("");
  const [filename, setFilename] = useState("PDF Viewer");
  const [pageInfo, setPageInfo] = useState<PageInfo>({ current: 0, total: 0 });
  const [renderProgress, setRenderProgress] = useState(0);
  const [totalSegments, setTotalSegments] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");

  // Scale factor for transform: scale() responsive container
  const [scaleFactor, setScaleFactor] = useState(1);

  const viewerRef = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<PDFAdapter>(new PDFAdapter());
  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const pdfViewports = useRef<Map<number, pdfjsLib.PageViewport>>(new Map());
  const pageContainers = useRef<Map<number, HTMLDivElement>>(new Map());
  const renderedPages = useRef<Set<number>>(new Set());

  // ---- Init ----

  useEffect(() => {
    const url = extractOriginalUrl();
    if (!url) { setState("error"); setErrorMessage("No document URL provided."); return; }
    if (detectDocumentType(url) !== "pdf") { setState("unsupported"); return; }

    setDocumentUrl(url);
    try {
      const name = new URL(url).pathname.split("/").pop() || "document.pdf";
      setFilename(decodeURIComponent(name));
    } catch { setFilename("document.pdf"); }

    loadPdfJs()
      .then(() => initPdf(url))
      .catch((err) => {
        console.error("[Brave Read Aloud] PDF init error:", err);
        setState("error");
        setErrorMessage(err instanceof Error ? err.message : "Failed to load PDF");
      });

    return () => { adapterRef.current.reset(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- PDF.js dynamic loader ----

  function loadPdfJs(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = chrome.runtime.getURL("pdf-reader/pdf.min.js");
      script.onload = () => {
        pdfjsLib.GlobalWorkerOptions.workerSrc =
          chrome.runtime.getURL("pdf-reader/pdf.worker.min.js");
        resolve();
      };
      script.onerror = () => reject(new Error("Failed to load PDF.js"));
      document.head.appendChild(script);
    });
  }

  // ---- Init PDF: load document, pre-parse all text content ----

  async function initPdf(url: string): Promise<void> {
    setState("rendering");

    const loadingTask = pdfjsLib.getDocument({ url });
    const pdfDoc = await loadingTask.promise;
    pdfDocRef.current = pdfDoc;

    const totalPages = pdfDoc.numPages;
    if (totalPages === 0) { setState("error"); setErrorMessage("PDF has no pages"); return; }

    setPageInfo({ current: 0, total: totalPages });
    adapterRef.current.reset();

    // Calculate scale factor based on container width
    updateScaleFactor();

    // Parse pages in batches using requestIdleCallback
    await batchedParse(pdfDoc, totalPages);

    setState("ready");
  }

  // ---- Batched parsing with requestIdleCallback ----

  async function batchedParse(pdfDoc: pdfjsLib.PDFDocumentProxy, totalPages: number): Promise<void> {
    let parsedCount = 0;

    for (let batchStart = 1; batchStart <= totalPages; batchStart += BATCH_SIZE) {
      // Wait for browser idle time before each batch
      await new Promise<void>((resolve) => {
        if (typeof requestIdleCallback !== "undefined") {
          requestIdleCallback(() => resolve(), { timeout: 100 });
        } else {
          setTimeout(resolve, 0);
        }
      });

      const batchEnd = Math.min(batchStart + BATCH_SIZE - 1, totalPages);

      for (let pageNum = batchStart; pageNum <= batchEnd; pageNum++) {
        try {
          const page = await pdfDoc.getPage(pageNum);
          const viewport = page.getViewport({ scale: SCALE });
          pdfViewports.current.set(pageNum, viewport);

          const textContent = await page.getTextContent();
          adapterRef.current.addPageTextContent(
            pageNum,
            textContent.items as unknown as pdfjsLib.TextItem[],
            viewport
          );

          parsedCount++;
          setPageInfo({ current: parsedCount, total: totalPages });
          setRenderProgress(Math.round((parsedCount / totalPages) * 100));
        } catch (err) {
          console.error(`[Brave Read Aloud] Parse error page ${pageNum}:`, err);
        }
      }
    }
  }

  // ---- Scale factor for responsive container ----

  function updateScaleFactor(): void {
    if (!viewerRef.current) return;
    const containerWidth = viewerRef.current.clientWidth;
    // Use a default viewport width or the first page's viewport
    const viewportWidth = (SCALE * 595) || containerWidth; // 595 = A4 width in pt
    const factor = Math.min(1, containerWidth / viewportWidth);
    setScaleFactor(factor);
  }

  useEffect(() => {
    const onResize = (): void => updateScaleFactor();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // ---- Render a page (canvas + overlay hydration) ----

  const renderPage = useCallback(async (
    pageNum: number,
    container: HTMLDivElement
  ): Promise<void> => {
    const pdfDoc = pdfDocRef.current;
    const viewport = pdfViewports.current.get(pageNum);
    if (!pdfDoc || !viewport) return;

    // Clear previous render
    container.innerHTML = "";

    // Set container dimensions to viewport (locked by transform: scale())
    container.style.position = "relative";
    container.style.width = `${viewport.width}px`;
    container.style.height = `${viewport.height}px`;
    container.style.transform = `scale(${scaleFactor})`;
    container.style.transformOrigin = "top left";
    container.className = "page-container";

    // Canvas (z-index: 0)
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.style.cssText = "display: block;";
    container.appendChild(canvas);

    // Render canvas
    const page = await pdfDoc.getPage(pageNum);
    const ctx = canvas.getContext("2d");
    if (ctx) {
      await page.render({ canvasContext: ctx, viewport }).promise;
    }

    // Hydrate overlay + textLayer via adapter
    adapterRef.current.hydratePage(pageNum, container);

    pageContainers.current.set(pageNum, container);
    renderedPages.current.add(pageNum);
  }, [scaleFactor]);

  // ---- Virtuoso item renderer ----

  interface VirtuosoContext {
    pageNums: number[];
  }

  const virtuosoItemContent = useCallback(
    (_index: number, pageNum: number) => {
      const containerRef = (el: HTMLDivElement | null) => {
        if (el && !renderedPages.current.has(pageNum)) {
          renderPage(pageNum, el);
        }
      };

      return (
        <div
          ref={containerRef}
          className="page-container"
          style={{
            margin: "8px auto",
            boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
            background: "#fff",
          }}
        />
      );
    },
    [renderPage]
  );

  // Generate page number array for virtuoso
  const pageNums = Array.from(
    { length: pageInfo.total },
    (_, i) => i + 1
  );

  // ---- TTS Controls (stub — wired in v2-09 integration) ----

  const handlePlay = useCallback(() => {
    if (typeof window === "undefined") return;
    setState("reading");
    // Extract text via adapter
    const nodes = adapterRef.current.extractNodes();
    setTotalSegments(nodes.length);
    console.debug("[Brave Read Aloud] PDF TTS start:", nodes.length, "words");
    // v2-09: PlaybackController.start(adapter, provider, settings)
  }, []);

  const handleStop = useCallback(() => {
    setState("ready");
    adapterRef.current.clearHighlight();
  }, []);

  const handlePrev = useCallback(() => {
    if (typeof window !== "undefined") window.scrollBy({ top: -400, behavior: "smooth" });
  }, []);

  const handleNext = useCallback(() => {
    if (typeof window !== "undefined") window.scrollBy({ top: 400, behavior: "smooth" });
  }, []);

  // ---- Render ----

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      {/* Toolbar */}
      <div style={S.toolbar}>
        <span style={S.toolbarTitle}>{filename}</span>

        {(state === "ready" || state === "reading") && (
          <>
            <button style={S.btn} onClick={handlePrev}>◀</button>
            <span style={S.pageInfo}>
              {pageInfo.current}/{pageInfo.total}
            </span>
            <button style={S.btn} onClick={handleNext}>▶</button>
          </>
        )}

        {state === "ready" && (
          <button style={S.btnPrimary} onClick={handlePlay}>▶ Đọc</button>
        )}
        {state === "reading" && (
          <button style={{ ...S.btnPrimary, background: "#d93025" }} onClick={handleStop}>
            ■ Dừng
          </button>
        )}
      </div>

      {/* Viewer */}
      {state === "rendering" && (
        <div style={S.center}>
          <div style={{ fontSize: 18, marginBottom: 8 }}>
            Parsing PDF ({renderProgress}%)
          </div>
          <div style={{ width: 200, height: 6, background: "rgba(255,255,255,0.1)", borderRadius: 3, overflow: "hidden", marginTop: 12 }}>
            <div style={{ height: "100%", width: `${renderProgress}%`, background: "#4361ee", borderRadius: 3, transition: "width 0.2s" }} />
          </div>
          <div style={{ fontSize: 12, opacity: 0.5, marginTop: 8 }}>
            {totalSegments > 0 ? `${totalSegments} words extracted` : ""}
          </div>
        </div>
      )}

      {state === "ready" || state === "reading" ? (
        <div ref={viewerRef} style={{ flex: 1, marginTop: 44, overflowY: "auto", background: "#525659", padding: "16px 0" }}>
          <Virtuoso
            style={{ height: "calc(100vh - 44px)" }}
            totalCount={pageInfo.total}
            itemContent={(_index: number) => {
              const pageNum = _index + 1;
              return virtuosoItemContent(_index, pageNum);
            }}
            increaseViewportBy={{ top: 800, bottom: 800 }}
          />
        </div>
      ) : null}

      {state === "error" && (
        <div style={S.center}>
          <div style={{ fontSize: 18, color: "#ff6b6b", marginBottom: 8 }}>Could not load PDF</div>
          <div style={{ fontSize: 13, opacity: 0.6 }}>{errorMessage}</div>
        </div>
      )}

      {state === "unsupported" && (
        <div style={S.center}>
          <div style={{ fontSize: 18, color: "#ffd43b", marginBottom: 8 }}>Unsupported Document Type</div>
          <div style={{ fontSize: 13, opacity: 0.6 }}>The URL does not point to a PDF document.</div>
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
  console.error("[Brave Read Aloud] PDF viewer: #root not found");
}

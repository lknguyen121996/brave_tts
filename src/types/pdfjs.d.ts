// ============================================================
// PDF.js Type Declarations — V2-05
// ============================================================
//
// Ambient declarations for the global `pdfjsLib` API
// (PDF.js v3.11.174, vendored in pdf-reader/pdf.min.js).
//
// PDF.js is loaded via a dynamic <script> tag in the viewer
// page because it's not an ES module. This declaration file
// makes the global API type-safe in TypeScript.
//
// The types declared here cover only the API surface used by
// the PDF viewer page and PDFAdapter.

declare namespace pdfjsLib {
  // ---- Entry Points ----

  function getDocument(
    params: GetDocumentParams
  ): PDFDocumentLoadingTask;

  function renderTextLayer(
    params: RenderTextLayerParams
  ): TextLayerRenderTask;

  // ---- Global Config ----

  const GlobalWorkerOptions: {
    workerSrc: string;
  };

  // ---- Types ----

  interface GetDocumentParams {
    url?: string;
    data?: ArrayBuffer | Uint8Array;
    [key: string]: unknown;
  }

  interface PDFDocumentLoadingTask {
    promise: Promise<PDFDocumentProxy>;
  }

  interface PDFDocumentProxy {
    numPages: number;
    getPage(pageNumber: number): Promise<PDFPageProxy>;
  }

  interface PDFPageProxy {
    getViewport(params: { scale: number; rotation?: number }): PageViewport;
    render(params: RenderParams): RenderTask;
    getTextContent(
      params?: GetTextContentParams
    ): Promise<TextContent>;
  }

  interface PageViewport {
    width: number;
    height: number;
    scale: number;
    rotation: number;
    /** Convert PDF user-space coordinates to CSS viewport coordinates. Returns [x, y] with top-left origin. */
    convertToViewportPoint(x: number, y: number): [number, number];
  }

  interface RenderParams {
    canvasContext: CanvasRenderingContext2D;
    viewport: PageViewport;
  }

  interface RenderTask {
    promise: Promise<void>;
  }

  interface GetTextContentParams {
    normalizeWhitespace?: boolean;
    disableNormalization?: boolean;
  }

  // ---- Text Content ----

  interface TextContent {
    items: TextItem[];
    styles: Record<string, TextStyle>;
  }

  interface TextItem {
    /** Extracted text string */
    str: string;
    /** Text direction: "ltr" or "rtl" */
    dir: string;
    /** Width in PDF user space */
    width: number;
    /** Height in PDF user space */
    height: number;
    /** Transform matrix [a, b, c, d, e, f]; e=X, f=Y in PDF coords */
    transform: number[];
    /** Key into TextContent.styles */
    fontName: string;
    /** True if this item ends a text line */
    hasEOL: boolean;
  }

  interface TextStyle {
    fontFamily: string;
    ascent: number;
    descent: number;
    vertical: boolean;
  }

  // ---- Text Layer Rendering ----

  interface RenderTextLayerParams {
    textContentSource: TextContent;
    container: HTMLElement;
    viewport: PageViewport;
    textDivs: HTMLElement[];
  }

  interface TextLayerRenderTask {
    promise: Promise<void>;
    cancel: () => void;
  }
}

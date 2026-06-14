// ============================================================
// PDFAdapter — PDF Pro Overlay: Word-level Highlight
// ============================================================
//
// Implements IDocumentAdapter for PDF documents rendered by
// PDF.js. Uses a hybrid approach:
//
// Layer stack (per page container):
//   z-index: 2  TextLayer <div>          opacity: 0
//               (selection/copy/find via <span> elements)
//   z-index: 1  Overlay <div>            pointer-events: none
//               └─ <div> x N (pure rects, zero text content)
//   z-index: 0  <canvas>                 PDF.js render
//
// Strategy (see DECISIONS.md § "PDF Pro Overlay"):
// 1. page.getTextContent() → reconstructWords() → WordObject[]
//    per page, with viewport.convertToViewportPoint() mapping
// 2. Virtualiser hydrates overlay divs for visible pages only
// 3. Highlight via CSS class on both overlay div + textLayer span
// 4. Binary search on startCharIndex/endCharIndex for TTS sync
// 5. Memory: WordObject[] released on page unmount
//
// Ghi đè trực tiếp PDFAdapter.ts (v2-05) — xem grill session.

import { IDocumentAdapter, AdapterDefaults } from "@adapters/IDocumentAdapter";
import type {
  TextNodePayload,
  LookupTable,
  AdapterOutput,
} from "@shared/types";

// ---- PDF.js types (from src/types/pdfjs.d.ts ambient declarations) ----

type PdfTextItem = pdfjsLib.TextItem;
type PdfViewport = pdfjsLib.PageViewport;

// ---- Internal types ----

interface WordObject {
  id: string; // e.g. "w_42"
  text: string;
  /** Character offset in the full concatenated text */
  startCharIndex: number;
  endCharIndex: number;
  /** CSS left in viewport space (after convertToViewportPoint) */
  x: number;
  /** CSS top in viewport space */
  y: number;
  width: number;
  height: number;
}

interface PageData {
  words: WordObject[];
  container: HTMLElement | null;
  overlayEl: HTMLDivElement | null;
  textDivs: HTMLSpanElement[];
}

interface SortableItem {
  y: number;
  x: number;
  originalIndex: number;
}

// ---- Constants ----

const Y_CLUSTER_THRESHOLD = 5; // px — words within this Y diff are same line
const HIGHLIGHT_CLASS = "tts-active-word";
const HIGHLIGHT_CSS = "tts-active-word-css";

// ---- PDFAdapter Class ----

export class PDFAdapter implements IDocumentAdapter {
  readonly documentType = "pdf";

  // ---- State ----

  /** Word data per page number (1-indexed). Null if page not yet parsed. */
  private pageWords = new Map<number, WordObject[]>();

  /** Per-page DOM: container ref + overlay div + textLayer spans */
  private pages = new Map<number, PageData>();

  /** All overlay divs keyed by word ID (across visible pages only) */
  private overlayDivs = new Map<string, HTMLDivElement>();

  /** All textLayer spans keyed by word ID (across visible pages) */
  private textLayerSpans = new Map<string, HTMLSpanElement>();

  /** Active highlighted word IDs */
  private activeWordIds = new Set<string>();

  /** Injected highlight CSS style element */
  private highlightStyleEl: HTMLStyleElement | null = null;

  // Extraction cache
  private payloads: TextNodePayload[] = [];
  private lookupTable: LookupTable = [];
  private fullText = "";

  // ---- Public: PDF-specific ----

  /**
   * Feed parsed text content for a page.
   * Called after `page.getTextContent()` in the viewer's batched parse loop.
   *
   * @param pageNum 1-indexed page number
   * @param items PDF.js TextItem array
   * @param viewport PDF.js page viewport
   */
  addPageTextContent(
    pageNum: number,
    items: PdfTextItem[],
    viewport: PdfViewport
  ): WordObject[] {
    // Remove existing data for this page if reparsing
    this.dehydratePage(pageNum);
    this.pageWords.delete(pageNum);

    // Step 1: Sort items into logical reading order
    const sorted = this.sortByReadOrder(items);

    // Step 2: Reconstruct words from fragmented TextItems
    const words = this.reconstructWords(sorted, viewport, pageNum);

    // Step 3: Cache word data (no DOM yet)
    this.pageWords.set(pageNum, words);

    // Step 4: Init page data (overlay + spans created on hydrate)
    this.pages.set(pageNum, {
      words,
      container: null,
      overlayEl: null,
      textDivs: [],
    });

    return words;
  }

  /**
   * Hydrate the overlay DOM for a page that just became visible.
   * Called by the virtualiser when a page mounts.
   *
   * @param pageNum 1-indexed page number
   * @param container The page container element (position: relative)
   * @returns The overlay div element (appended to container)
   */
  hydratePage(pageNum: number, container: HTMLElement): HTMLDivElement | null {
    const page = this.pages.get(pageNum);
    const words = this.pageWords.get(pageNum);
    if (!page || !words || words.length === 0) return null;

    // Dehydrate first if already hydrated
    if (page.overlayEl) this.dehydratePage(pageNum);

    page.container = container;

    // Ensure container is positioned
    const containerStyle = window.getComputedStyle(container);
    if (containerStyle.position === "static") {
      container.style.position = "relative";
    }

    // Inject highlight CSS into document once
    this.ensureHighlightStyle();

    // Create overlay div
    const overlay = document.createElement("div");
    overlay.className = "brave-tts-pdf-overlay";
    overlay.style.cssText =
      "position: absolute; top: 0; left: 0; width: 100%; height: 100%; " +
      "pointer-events: none; z-index: 1; contain: layout style;";
    overlay.setAttribute("data-brave-tts-page", String(pageNum));

    // Create word-level overlay divs (pure rects, ZERO text)
    for (const word of words) {
      const div = document.createElement("div");
      div.id = word.id;
      div.setAttribute("data-brave-tts-word", word.id);
      div.style.cssText =
        `position: absolute; ` +
        `left: ${word.x}px; ` +
        `top: ${word.y}px; ` +
        `width: ${word.width}px; ` +
        `height: ${word.height}px; ` +
        // No textContent — pure visual rectangle
        "pointer-events: none;";
      overlay.appendChild(div);
      this.overlayDivs.set(word.id, div);
    }

    // Create textLayer spans for selection/copy (opacity: 0)
    // These sit at z-index: 2 above the overlay
    const textLayer = document.createElement("div");
    textLayer.className = "brave-tts-text-layer";
    textLayer.style.cssText =
      "position: absolute; top: 0; left: 0; width: 100%; height: 100%; " +
      "opacity: 0; z-index: 2;";
    textLayer.setAttribute("data-brave-tts-page", String(pageNum));

    for (const word of words) {
      const span = document.createElement("span");
      span.id = `s_${word.id}`;
      span.setAttribute("data-word-id", word.id);
      span.textContent = word.text + " "; // Space between words for selection
      span.style.cssText =
        `position: absolute; ` +
        `left: ${word.x}px; ` +
        `top: ${word.y}px; ` +
        `width: ${word.width}px; ` +
        `height: ${word.height}px; ` +
        "overflow: hidden;";
      textLayer.appendChild(span);
      this.textLayerSpans.set(word.id, span);
    }

    page.textDivs = Array.from(textLayer.querySelectorAll("span"));

    // Append in correct z-order: overlay (z:1) then textLayer (z:2)
    container.appendChild(overlay);
    container.appendChild(textLayer);
    page.overlayEl = overlay;

    return overlay;
  }

  /**
   * Dehydrate: remove overlay and textLayer DOM for a page.
   * Called by the virtualiser when a page unmounts.
   * Frees DOM nodes — WordObject[] data stays cached.
   */
  dehydratePage(pageNum: number): void {
    const page = this.pages.get(pageNum);
    if (!page) return;

    // Remove overlay divs from map
    if (page.overlayEl) {
      const wordDivs = page.overlayEl.querySelectorAll("[data-brave-tts-word]");
      for (const div of wordDivs) {
        const id = div.getAttribute("data-brave-tts-word")!;
        this.overlayDivs.delete(id);
      }
      page.overlayEl.remove();
      page.overlayEl = null;
    }

    // Remove textLayer spans from map
    for (const span of page.textDivs) {
      const wordId = span.getAttribute("data-word-id");
      if (wordId) this.textLayerSpans.delete(wordId);
    }

    // Remove textLayer element (find by attribute)
    if (page.container) {
      const textLayer = page.container.querySelector(
        '[data-brave-tts-page="' + String(pageNum) + '"].brave-tts-text-layer'
      );
      if (textLayer) textLayer.remove();
    }

    page.textDivs = [];
    page.container = null;
  }

  /**
   * Release ALL data for a page (both DOM and WordObject[] data).
   * Called when user closes the PDF or for aggressive memory cleanup.
   */
  releasePageData(pageNum: number): void {
    this.dehydratePage(pageNum);
    this.pageWords.delete(pageNum);
    this.pages.delete(pageNum);
  }

  /** Clear everything — full reset (new PDF load). */
  reset(): void {
    for (const pageNum of this.pages.keys()) {
      this.dehydratePage(pageNum);
    }
    this.pageWords.clear();
    this.pages.clear();
    this.overlayDivs.clear();
    this.textLayerSpans.clear();
    this.activeWordIds.clear();
    this.payloads = [];
    this.lookupTable = [];
    this.fullText = "";
    if (this.highlightStyleEl) {
      this.highlightStyleEl.remove();
      this.highlightStyleEl = null;
    }
  }

  /** Get all parsed pages as a flat array of WordObject[] */
  getAllWords(): WordObject[] {
    const all: WordObject[] = [];
    for (const words of this.pageWords.values()) {
      all.push(...words);
    }
    return all;
  }

  // ---- IDocumentAdapter Implementation ----

  extractNodes(): TextNodePayload[] {
    const allPayloads: TextNodePayload[] = [];
    let globalCharIndex = 0;
    let idCounter = 0;

    // Process pages in order
    const pageNums = Array.from(this.pageWords.keys()).sort((a, b) => a - b);

    for (const pageNum of pageNums) {
      const words = this.pageWords.get(pageNum);
      if (!words) continue;

      for (const word of words) {
        const id = `p${idCounter++}`;
        allPayloads.push({
          id,
          text: word.text,
          charIndex: globalCharIndex,
          charLength: word.text.length,
          // domNode = textLayer span for this word (for selection)
          domNode: this.textLayerSpans.get(word.id) ?? null,
        });
        globalCharIndex += word.text.length;
      }
    }

    this.payloads = allPayloads;
    this.fullText = allPayloads.map((p) => p.text).join("");
    this.lookupTable = this.buildLookupTable(allPayloads);
    return allPayloads;
  }

  buildLookupTable(nodes: TextNodePayload[]): LookupTable {
    return AdapterDefaults.buildLookupTable(nodes);
  }

  extract(): AdapterOutput {
    if (this.payloads.length === 0) {
      this.extractNodes();
    }
    return {
      nodes: this.payloads,
      lookupTable: this.lookupTable,
      fullText: this.fullText,
    };
  }

  getFullText(nodes: TextNodePayload[]): string {
    return AdapterDefaults.getFullText(nodes);
  }

  // ---- Highlight (Hybrid: overlay div + textLayer span) ----

  highlight(nodeIds: string[]): void {
    this.clearHighlight();
    this.activeWordIds = new Set(nodeIds);

    for (const id of nodeIds) {
      // Find the WordObject to get its word.id
      // The nodeId from payload is "p0", "p1", etc.
      // We need to map it to overlay div "w_42"
      const wordId = this.payloadToWordId(id);
      if (!wordId) continue;

      // Highlight overlay div (z:1, visual)
      const overlayDiv = this.overlayDivs.get(wordId);
      if (overlayDiv) {
        overlayDiv.classList.add(HIGHLIGHT_CLASS);
      }

      // Highlight textLayer span (z:2, selection layer)
      const span = this.textLayerSpans.get(wordId);
      if (span) {
        span.classList.add(HIGHLIGHT_CLASS);
      }
    }
  }

  clearHighlight(): void {
    // Remove from overlay divs
    for (const id of this.activeWordIds) {
      const wordId = this.payloadToWordId(id);
      if (!wordId) continue;

      const overlayDiv = this.overlayDivs.get(wordId);
      if (overlayDiv) overlayDiv.classList.remove(HIGHLIGHT_CLASS);

      const span = this.textLayerSpans.get(wordId);
      if (span) span.classList.remove(HIGHLIGHT_CLASS);
    }
    this.activeWordIds.clear();
  }

  // ---- Scroll ----

  scrollToNode(nodeId: string): void {
    const wordId = this.payloadToWordId(nodeId);
    if (!wordId) return;

    // Find which page contains this word
    for (const [pageNum, page] of this.pages) {
      if (page.container) {
        const div = page.container.querySelector(`[data-brave-tts-word="${wordId}"]`);
        if (div) {
          // Scroll the page into view
          div.scrollIntoView({ behavior: "smooth", block: "center" });
          return;
        }
      }
    }
  }

  // ---- Private: Word Reconstruction ----

  /**
   * Sort PDF TextItems into logical reading order (Y-cluster + X-sort).
   *
   * Groups items with Y coordinates within Y_CLUSTER_THRESHOLD pixels
   * (same text line), sorts each group left-to-right, then sorts
   * groups top-to-bottom.
   */
  private sortByReadOrder(items: PdfTextItem[]): PdfTextItem[] {
    if (items.length === 0) return [];

    // Build sortable entries using raw transform Y/X
    const sortables: SortableItem[] = items.map((item, i) => ({
      y: item.transform[5] ?? 0, // f = Y in PDF space
      x: item.transform[4] ?? 0, // e = X in PDF space
      originalIndex: i,
    }));

    // Sort by Y descending (PDF origin bottom-left → top-to-bottom)
    sortables.sort((a, b) => b.y - a.y);

    // Group into Y-clusters
    const clusters: SortableItem[][] = [];
    const firstItem = sortables[0];
    if (!firstItem) return [];
    let currentCluster: SortableItem[] = [firstItem];
    let clusterY = firstItem.y;

    for (let i = 1; i < sortables.length; i++) {
      const item = sortables[i];
      if (!item) continue;
      if (Math.abs(item.y - clusterY) < Y_CLUSTER_THRESHOLD) {
        currentCluster.push(item);
      } else {
        clusters.push(currentCluster);
        currentCluster = [item];
        clusterY = item.y;
      }
    }
    clusters.push(currentCluster);

    // X-sort each cluster (left-to-right)
    for (const cluster of clusters) {
      cluster.sort((a, b) => a.x - b.x);
    }

    // Flatten: clusters are already top-to-bottom from the Y-descending sort
    const sortedIndices = clusters.flat().map((s) => s.originalIndex);
    return sortedIndices.map((i) => items[i]).filter((item): item is PdfTextItem => item != null);
  }

  /**
   * Reconstruct word-level objects from sorted PDF TextItems.
   *
   * PDF.js often splits a single word into multiple TextItems
   * (e.g., "H", "ello"). This merges consecutive non-whitespace
   * items into coherent WordObjects with merged bounding boxes.
   */
  private reconstructWords(
    items: PdfTextItem[],
    viewport: PdfViewport,
    pageNum: number
  ): WordObject[] {
    const words: WordObject[] = [];
    let wordIndex = 0;
    let globalCharOffset = 0; // Will be computed after all words built

    let currentText = "";
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let pendingItems: PdfTextItem[] = [];

    const flushWord = (): void => {
      if (currentText.length === 0) return;

      // Convert PDF-space coordinates to viewport (CSS) space
      const [vpX, vpY] = viewport.convertToViewportPoint(minX, maxY);
      const [vpX2, vpY2] = viewport.convertToViewportPoint(maxX, minY);

      const x = vpX;
      const y = vpY2; // top in CSS
      const width = vpX2 - vpX;
      const height = vpY - vpY2;

      words.push({
        id: `w_${pageNum}_${wordIndex++}`,
        text: currentText,
        startCharIndex: 0, // Filled in next pass
        endCharIndex: 0,
        x,
        y,
        width: Math.max(width, 1),
        height: Math.max(height, 1),
      });

      currentText = "";
      minX = Infinity;
      minY = Infinity;
      maxX = -Infinity;
      maxY = -Infinity;
      pendingItems = [];
    };

    for (const item of items) {
      const isWhitespace = item.str.trim() === "";

      if (isWhitespace) {
        flushWord();
        continue;
      }

      // Extract coordinates from PDF transform
      const pdfX = item.transform[4] ?? 0;
      const pdfY = item.transform[5] ?? 0;
      const itemW = item.width * viewport.scale;
      const itemH = item.height * viewport.scale;

      currentText += item.str;
      minX = Math.min(minX, pdfX);
      minY = Math.min(minY, pdfY);
      maxX = Math.max(maxX, pdfX + itemW);
      maxY = Math.max(maxY, pdfY + itemH);
      pendingItems.push(item);
    }
    flushWord();

    // Second pass: compute global charIndex offsets
    let charIndex = 0;
    for (const word of words) {
      word.startCharIndex = charIndex;
      word.endCharIndex = charIndex + word.text.length - 1;
      charIndex += word.text.length;
    }

    return words;
  }

  // ---- Private: Highlight CSS ----

  /** Inject highlight styles into the document (once). */
  private ensureHighlightStyle(): void {
    if (this.highlightStyleEl) return;

    const style = document.createElement("style");
    style.id = HIGHLIGHT_CSS;
    style.textContent = `
      .${HIGHLIGHT_CLASS} {
        background-color: #a3e635 !important;
        mix-blend-mode: multiply;
      }
      /* Overlay div highlight */
      [data-brave-tts-word].${HIGHLIGHT_CLASS} {
        background-color: #a3e635 !important;
        mix-blend-mode: multiply;
      }
      /* TextLayer span highlight (selection layer) */
      [data-word-id].${HIGHLIGHT_CLASS} {
        background-color: #a3e635 !important;
        mix-blend-mode: multiply;
      }
    `;
    document.head.appendChild(style);
    this.highlightStyleEl = style;
  }

  // ---- Private: ID Mapping ----

  /**
   * Map a payload ID ("p0", "p1", ...) to a word ID ("w_1_0", ...).
   * Uses the payload-to-word correspondence based on extraction order.
   */
  private payloadToWordId(payloadId: string): string | null {
    if (this.payloads.length === 0) this.extractNodes();

    const index = this.payloads.findIndex((p) => p.id === payloadId);
    if (index < 0) return null;

    // Payloads are built in the same order as getAllWords()
    const allWords = this.getAllWords();
    const word = allWords[index];
    return word?.id ?? null;
  }
}

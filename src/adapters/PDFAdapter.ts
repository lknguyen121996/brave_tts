// ============================================================
// PDFAdapter — LineObject Highlight Manager
// ============================================================
//
// Nâng cấp từ per-word overlay sang per-line:
// - WordObject → LineObject bằng Vertical Interval Overlap (>50% height)
//   + Gap Detection (multi-column)
// - 1 div/dòng thay vì 1 div/từ → DOM nodes giảm ~10x (20k → 2k)
// - Highlight qua <span> con tạm thời (max 3/line)
//   với trailing effects (active=1.0, prev1=0.6, prev2=0.3)
// - CSS transition: opacity 0.2s ease-in-out
// - Sentence boundary → clear trail ngay
// - Binary search LineObject[] cho word lookup
//
// Layer stack (per page container):
//   z-index: 2  TextLayer <div>          opacity: 0
//               (selection/copy/find via <span> elements)
//   z-index: 1  Overlay <div>            pointer-events: none
//               └─ LineObject div × L    (L = số dòng, ~2000)
//                    └─ <span> × 0-3    (temporary, TTS-driven)
//   z-index: 0  <canvas>                 PDF.js render
//
// Ghi đè trực tiếp PDFAdapter.ts — see PROGRESS.md § "LineObject Highlight Manager"

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
  id: string; // e.g. "w_1_42"
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

interface LineObject {
  id: string; // e.g. "L_1_0"
  /** Bounding box in viewport space (union of all words in this line) */
  bbox: { x: number; y: number; width: number; height: number };
  startCharIndex: number;
  endCharIndex: number;
  /** Words in this line, sorted left-to-right */
  words: WordObject[];
}

interface PageData {
  words: WordObject[];
  lines: LineObject[];
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
const MAX_TRAIL = 3; // Max highlight spans per line
const GAP_CHAR_MULTIPLIER = 3; // deltaX > avg_char * 3 → column break

// ---- PDFAdapter Class ----

export class PDFAdapter implements IDocumentAdapter {
  readonly documentType = "pdf";

  // ---- State ----

  /** Word data per page number (1-indexed). Null if page not yet parsed. */
  private pageWords = new Map<number, WordObject[]>();

  /** Line data per page number (1-indexed). Built from words during hydrate. */
  private lineMap = new Map<number, LineObject[]>();

  /** Per-page DOM: container ref + overlay div + textLayer spans */
  private pages = new Map<number, PageData>();

  /** LineObject overlay divs keyed by line ID (across visible pages only) */
  private lineDivs = new Map<string, HTMLDivElement>();

  /** All textLayer spans keyed by word ID (across visible pages) */
  private textLayerSpans = new Map<string, HTMLSpanElement>();

  /** Trail spans per line: lineId → span[] (max MAX_TRAIL, newest last) */
  private trailQueues = new Map<string, HTMLSpanElement[]>();

  /** Active highlighted word IDs (for textLayer span cleanup) */
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
    this.lineMap.delete(pageNum);

    // Step 1: Sort items into logical reading order
    const sorted = this.sortByReadOrder(items);

    // Step 2: Reconstruct words from fragmented TextItems
    const words = this.reconstructWords(sorted, viewport, pageNum);

    // Step 3: Build lines from words
    const lines = this.buildLines(words);

    // Step 4: Cache data (no DOM yet)
    this.pageWords.set(pageNum, words);
    this.lineMap.set(pageNum, lines);

    // Step 5: Init page data (overlay + spans created on hydrate)
    this.pages.set(pageNum, {
      words,
      lines,
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
   * Creates LineObject divs (1 per line) instead of per-word divs.
   * Uses chunked DocumentFragment rendering with requestIdleCallback
   * to avoid blocking the main thread with ~2000 synchronous DOM inserts.
   *
   * @param pageNum 1-indexed page number
   * @param container The page container element (position: relative)
   * @returns The overlay div element (appended to container)
   */
  hydratePage(pageNum: number, container: HTMLElement): HTMLDivElement | null {
    const page = this.pages.get(pageNum);
    const words = this.pageWords.get(pageNum);
    const lines = this.lineMap.get(pageNum);
    if (!page || !words || words.length === 0 || !lines) return null;

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

    // ---- Overlay layer (z-index: 1) ----
    // Create 1 div per LineObject (pure rects, ZERO text)
    const overlay = document.createElement("div");
    overlay.className = "brave-tts-pdf-overlay";
    overlay.style.cssText =
      "position: absolute; top: 0; left: 0; width: 100%; height: 100%; " +
      "pointer-events: none; z-index: 1; contain: layout style;";
    overlay.setAttribute("data-brave-tts-page", String(pageNum));

    // Append overlay to container BEFORE populating line divs,
    // so it's in the DOM tree while chunked rendering fills it.
    container.appendChild(overlay);

    // Chunked render: ~2000 LineObject divs via DocumentFragment +
    // requestIdleCallback to keep the main thread responsive.
    this.renderLineChunk(lines, overlay);

    // ---- TextLayer (z-index: 2, opacity: 0) ----
    // Per-word spans for selection/copy/find
    const textLayer = document.createElement("div");
    textLayer.className = "brave-tts-text-layer";
    textLayer.style.cssText =
      "position: absolute; top: 0; left: 0; width: 100%; height: 100%; " +
      "opacity: 0; z-index: 2;";
    textLayer.setAttribute("data-brave-tts-page", String(pageNum));

    container.appendChild(textLayer);

    // Chunked render: per-word spans (typically ~2000 nodes per page)
    this.renderWordSpansChunked(words, textLayer, pageNum);

    page.textDivs = Array.from(textLayer.querySelectorAll("span"));

    // Overlay should be below textLayer in z-order
    // (already appended in correct order: overlay then textLayer)
    page.overlayEl = overlay;

    return overlay;
  }

  /**
   * Dehydrate: remove overlay and textLayer DOM for a page.
   * Called by the virtualiser when a page unmounts.
   * Frees DOM nodes — WordObject[] and LineObject[] data stays cached.
   */
  dehydratePage(pageNum: number): void {
    const page = this.pages.get(pageNum);
    if (!page) return;

    // Clear trail spans for this page's lines
    for (const line of page.lines) {
      const trail = this.trailQueues.get(line.id);
      if (trail) {
        for (const span of trail) span.remove();
        this.trailQueues.delete(line.id);
      }
      this.lineDivs.delete(line.id);
    }

    // Remove overlay div
    if (page.overlayEl) {
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
   * Release ALL data for a page (both DOM and data).
   * Called when user closes the PDF or for aggressive memory cleanup.
   */
  releasePageData(pageNum: number): void {
    this.dehydratePage(pageNum);
    this.pageWords.delete(pageNum);
    this.lineMap.delete(pageNum);
    this.pages.delete(pageNum);
  }

  /** Clear everything — full reset (new PDF load). */
  reset(): void {
    for (const pageNum of this.pages.keys()) {
      this.dehydratePage(pageNum);
    }
    this.pageWords.clear();
    this.lineMap.clear();
    this.pages.clear();
    this.lineDivs.clear();
    this.textLayerSpans.clear();
    this.trailQueues.clear();
    this.activeWordIds.clear();
    this.payloads = [];
    this.lookupTable = [];
    this.fullText = "";
    if (this.highlightStyleEl) {
      this.highlightStyleEl.remove();
      this.highlightStyleEl = null;
    }
  }

  /** Get all parsed words as a flat array (across all pages, in order). */
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

  // ---- Highlight (Trailing spans in LineObject divs) ----

  /**
   * Highlight the given node IDs using temporary <span> children
   * inside LineObject divs, with trailing effects.
   *
   * Each call ADDS a new span — does NOT clear previous ones.
   * Trail management: max 3 spans/line, opacities 1.0 → 0.6 → 0.3 → removed.
   * Sentence boundary (., !, ?): clears ALL trails immediately.
   */
  highlight(nodeIds: string[]): void {
    for (const nodeId of nodeIds) {
      const wordId = this.payloadToWordId(nodeId);
      if (!wordId) continue;

      const lineObj = this.findLineByWordId(wordId);
      if (!lineObj) continue;

      const word = lineObj.words.find((w) => w.id === wordId);
      if (!word) continue;

      const lineDiv = this.lineDivs.get(lineObj.id);
      if (!lineDiv) continue;

      // Get or create trail queue for this line
      let trail = this.trailQueues.get(lineObj.id);
      if (!trail) {
        trail = [];
        this.trailQueues.set(lineObj.id, trail);
      }

      // Create highlight span (positioned relative to line div)
      const span = document.createElement("span");
      span.className = "brave-tts-highlight-span";
      span.style.cssText =
        `position: absolute; ` +
        `left: ${word.x - lineObj.bbox.x}px; ` +
        `top: 0; ` +
        `width: ${word.width}px; ` +
        `height: 100%; ` +
        `opacity: 1.0; ` +
        `transition: opacity 0.2s ease-in-out; ` +
        `pointer-events: none;`;
      lineDiv.appendChild(span);

      // Push to trail
      trail.push(span);

      // Trim to MAX_TRAIL (3) — remove oldest
      while (trail.length > MAX_TRAIL) {
        const removed = trail.shift();
        removed?.remove();
      }

      // Update trail opacities: newest=1.0, prev1=0.6, prev2=0.3
      this.updateTrailOpacities(trail);

      // Also track in activeWordIds for textLayer cleanup
      this.activeWordIds.add(wordId);

      // Check sentence boundary → clear ALL trails globally
      if (/[.!?]$/.test(word.text)) {
        this.clearAllTrails();
      }
    }
  }

  /** Remove ALL highlight spans and textLayer highlights. */
  clearHighlight(): void {
    this.clearAllTrails();
    this.activeWordIds.clear();
  }

  // ---- Scroll ----

  scrollToNode(nodeId: string): void {
    const wordId = this.payloadToWordId(nodeId);
    if (!wordId) return;

    const lineObj = this.findLineByWordId(wordId);
    if (!lineObj) return;

    const lineDiv = this.lineDivs.get(lineObj.id);
    if (lineDiv) {
      lineDiv.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  // ---- Private: Line Building ----

  /**
   * Group WordObjects into LineObjects using:
   * 1. Vertical Interval Overlap (>50% height) — handles superscript/subscript
   * 2. Gap Detection (deltaX > avg_char * 3) — handles multi-column layout
   */
  private buildLines(words: WordObject[]): LineObject[] {
    if (words.length === 0) return [];

    // Step 1: Sort by Y center for clustering
    const sorted = [...words].sort((a, b) => {
      const aCY = a.y + a.height / 2;
      const bCY = b.y + b.height / 2;
      return aCY - bCY;
    });

    // Step 2: Cluster by vertical interval overlap (>50%)
    const clusters: WordObject[][] = [];
    {
      const first = sorted[0]!;
      let currentCluster: WordObject[] = [first];
      let clusterMinY = first.y;
      let clusterMaxY = first.y + first.height;
      let clusterHeights: number[] = [first.height];

      for (let i = 1; i < sorted.length; i++) {
        const word = sorted[i]!;

        // Compute vertical overlap between word and cluster bbox
        const overlapPx = Math.max(
          0,
          Math.min(clusterMaxY, word.y + word.height) -
            Math.max(clusterMinY, word.y)
        );
        const avgH =
          clusterHeights.reduce((s, h) => s + h, 0) / clusterHeights.length;
        const minH = Math.min(avgH, word.height);
        const overlapRatio = minH > 0 ? overlapPx / minH : 0;

        if (overlapRatio > 0.5) {
          currentCluster.push(word);
          clusterMinY = Math.min(clusterMinY, word.y);
          clusterMaxY = Math.max(clusterMaxY, word.y + word.height);
          clusterHeights.push(word.height);
        } else {
          clusters.push(currentCluster);
          currentCluster = [word];
          clusterMinY = word.y;
          clusterMaxY = word.y + word.height;
          clusterHeights = [word.height];
        }
      }
      clusters.push(currentCluster);
    }

    // Step 3: Within each cluster, sort by X, detect gaps, split columns
    const lines: LineObject[] = [];
    let lineIndex = 0;

    for (const cluster of clusters) {
      // Sort left-to-right
      cluster.sort((a, b) => a.x - b.x);

      // Compute avg char width for gap detection
      let totalChars = 0;
      let totalWidth = 0;
      for (const w of cluster) {
        totalChars += w.text.length;
        totalWidth += w.width;
      }
      const avgCharWidth = totalChars > 0 ? totalWidth / totalChars : 0;
      const gapThreshold = avgCharWidth * GAP_CHAR_MULTIPLIER;

      // Split by horizontal gaps (multi-column)
      const columns: WordObject[][] = [];
      {
        let currentCol: WordObject[] = [cluster[0]!];

        for (let i = 1; i < cluster.length; i++) {
          const prev = cluster[i - 1]!;
          const curr = cluster[i]!;
          const gap = curr.x - (prev.x + prev.width);

          if (gapThreshold > 0 && gap > gapThreshold) {
            columns.push(currentCol);
            currentCol = [curr];
          } else {
            currentCol.push(curr);
          }
        }
        columns.push(currentCol);
      }

      // Create LineObject for each column
      for (const colWords of columns) {
        if (colWords.length === 0) continue;

        const firstW = colWords[0]!;
        const lastW = colWords[colWords.length - 1]!;

        // Compute union bbox
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const w of colWords) {
          minX = Math.min(minX, w.x);
          minY = Math.min(minY, w.y);
          maxX = Math.max(maxX, w.x + w.width);
          maxY = Math.max(maxY, w.y + w.height);
        }

        lines.push({
          id: `L_${lineIndex++}`,
          bbox: {
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY,
          },
          startCharIndex: firstW.startCharIndex,
          endCharIndex: lastW.endCharIndex,
          words: colWords,
        });
      }
    }

    return lines;
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
      .brave-tts-highlight-span {
        background-color: #a3e635 !important;
        mix-blend-mode: multiply;
      }
      /* TextLayer span highlight (selection layer, opacity: 0) */
      [data-word-id].${HIGHLIGHT_CLASS} {
        background-color: #a3e635 !important;
        mix-blend-mode: multiply;
      }
    `;
    document.head.appendChild(style);
    this.highlightStyleEl = style;
  }

  // ---- Private: Chunked DOM Rendering ----

  /**
   * Render LineObject divs in chunks using DocumentFragment +
   * requestIdleCallback to avoid blocking the main thread with
   * ~2000 synchronous DOM insertions.
   *
   * @param lines     LineObjects to render as positioned divs
   * @param container Parent element to append line divs into
   * @param chunkSize How many lines per idle callback frame (default: 50)
   */
  private renderLineChunk(
    lines: LineObject[],
    container: HTMLElement,
    chunkSize = 50
  ): void {
    let index = 0;

    const processChunk = (deadline?: IdleDeadline): void => {
      const fragment = document.createDocumentFragment();
      const end = Math.min(index + chunkSize, lines.length);

      // Create and stage line divs into the DocumentFragment.
      // Yield when deadline is available and time is running out.
      while (
        index < end &&
        (deadline ? deadline.timeRemaining() > 1 : true)
      ) {
        const line = lines[index]!;
        const div = document.createElement("div");
        div.id = line.id;
        div.setAttribute("data-brave-tts-line", line.id);
        div.style.cssText =
          `position: absolute; ` +
          `left: ${line.bbox.x}px; ` +
          `top: ${line.bbox.y}px; ` +
          `width: ${line.bbox.width}px; ` +
          `height: ${line.bbox.height}px; ` +
          // No textContent — pure visual rectangle container
          "pointer-events: none;" +
          "overflow: visible;";
        fragment.appendChild(div);
        this.lineDivs.set(line.id, div);
        index++;
      }

      // Single DOM operation: append the whole fragment
      container.appendChild(fragment);

      // Schedule next chunk if more lines remain
      if (index < lines.length) {
        if (typeof requestIdleCallback !== "undefined") {
          requestIdleCallback(processChunk);
        } else {
          setTimeout(() => processChunk(), 0);
        }
      }
    };

    // Kick off first chunk
    if (typeof requestIdleCallback !== "undefined") {
      requestIdleCallback(processChunk);
    } else {
      setTimeout(() => processChunk(), 0);
    }
  }

  /**
   * Render per-word textLayer spans in chunks using the same
   * DocumentFragment + requestIdleCallback strategy as lines.
   *
   * The textLayer is opacity: 0 and only used for selection/copy/find,
   * so delayed rendering has zero visual impact.
   */
  private renderWordSpansChunked(
    words: WordObject[],
    container: HTMLElement,
    pageNum: number,
    chunkSize = 50
  ): void {
    let index = 0;

    const processChunk = (deadline?: IdleDeadline): void => {
      const fragment = document.createDocumentFragment();
      const end = Math.min(index + chunkSize, words.length);

      while (
        index < end &&
        (deadline ? deadline.timeRemaining() > 1 : true)
      ) {
        const word = words[index]!;
        const span = document.createElement("span");
        span.id = `s_${word.id}`;
        span.setAttribute("data-word-id", word.id);
        span.textContent = word.text + " ";
        span.style.cssText =
          `position: absolute; ` +
          `left: ${word.x}px; ` +
          `top: ${word.y}px; ` +
          `width: ${word.width}px; ` +
          `height: ${word.height}px; ` +
          "overflow: hidden;";
        fragment.appendChild(span);
        this.textLayerSpans.set(word.id, span);
        index++;
      }

      container.appendChild(fragment);

      if (index < words.length) {
        if (typeof requestIdleCallback !== "undefined") {
          requestIdleCallback(processChunk);
        } else {
          setTimeout(() => processChunk(), 0);
        }
      }
    };

    if (typeof requestIdleCallback !== "undefined") {
      requestIdleCallback(processChunk);
    } else {
      setTimeout(() => processChunk(), 0);
    }
  }

  // ---- Private: ID Mapping & Search ----

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

  /**
   * Find the LineObject containing a word by its ID.
   * Uses binary search on LineObject[].startCharIndex/endCharIndex.
   * O(log L) where L = number of lines in the page.
   */
  private findLineByWordId(wordId: string): LineObject | null {
    // wordId format: "w_pageNum_wordIndex"
    const parts = wordId.split("_");
    if (!parts[1]) return null;
    const pageNum = parseInt(parts[1], 10);
    if (isNaN(pageNum)) return null;

    const lines = this.lineMap.get(pageNum);
    if (!lines || lines.length === 0) return null;

    // Get the word to find its charIndex
    const words = this.pageWords.get(pageNum);
    const word = words?.find((w) => w.id === wordId);
    if (!word) return null;

    // Binary search on LineObject[] by charIndex range
    const targetChar = word.startCharIndex;
    let lo = 0;
    let hi = lines.length - 1;

    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const line = lines[mid]!;

      if (
        targetChar >= line.startCharIndex &&
        targetChar <= line.endCharIndex
      ) {
        return line;
      }

      if (targetChar < line.startCharIndex) {
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }

    return null;
  }

  /** Clear ALL trail spans across all lines and reset trail queues. */
  private clearAllTrails(): void {
    for (const [, trail] of this.trailQueues) {
      for (const span of trail) {
        span.remove();
      }
    }
    this.trailQueues.clear();
  }

  /** Update opacity for trail spans: newest=1.0, prev1=0.6, prev2=0.3. */
  private updateTrailOpacities(trail: HTMLSpanElement[]): void {
    const opacities: Record<number, string> = {
      [trail.length - 1]: "1.0",
      [trail.length - 2]: "0.6",
      [trail.length - 3]: "0.3",
    };

    trail.forEach((span, i) => {
      const opacity = opacities[i];
      if (opacity !== undefined) {
        span.style.opacity = opacity;
      }
    });
  }
}

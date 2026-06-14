// ============================================================
// PDFAdapter — PDF text extraction via PDF.js text layer
// ============================================================
//
// Implements IDocumentAdapter for PDF documents rendered by
// PDF.js. Each page is rendered as canvas + textLayer div;
// the adapter collects the rendered <span> elements, sorts
// them into logical reading order via Y-cluster + X-sort,
// and builds TextNodePayloads.
//
// Strategy (see DECISIONS.md § "PDF text sort"):
// 1. Viewer calls setPageData() after each page's renderTextLayer
// 2. extractNodes() Y-cluster sorts spans per page, concatenates
// 3. Highlight via CSS class on textLayer <span> elements
// 4. Scroll via page container (closest .page-container)
//
// No content script — the adapter lives in the viewer page.

import { IDocumentAdapter, AdapterDefaults } from "@adapters/IDocumentAdapter";
import type {
  TextNodePayload,
  LookupTable,
  AdapterOutput,
} from "@shared/types";

// ---- Internal types ----

interface PageData {
  textDivs: HTMLSpanElement[];
  viewportWidth: number;
  viewportHeight: number;
}

interface SortableItem {
  originalIndex: number;
  y: number;
  x: number;
  height: number;
}

// ---- PDFAdapter Class ----

export class PDFAdapter implements IDocumentAdapter {
  readonly documentType = "pdf";

  // Per-page rendering data
  private pageData: PageData[] = [];

  // Extraction results
  private payloads: TextNodePayload[] = [];
  private lookupTable: LookupTable = [];
  private fullText = "";

  // Maps payload ID → corresponding HTMLSpanElement for highlight/scroll
  private payloadMap = new Map<string, HTMLSpanElement>();

  // Active highlight tracking
  private highlightedSpans: HTMLSpanElement[] = [];

  // ---- Public methods (called by viewer page) ----

  /**
   * Feed per-page rendering data to the adapter.
   * Called after `pdfjsLib.renderTextLayer()` completes for each page.
   *
   * @param textDivs — The <span> elements created by renderTextLayer
   * @param viewportWidth — Page viewport width in CSS pixels
   * @param viewportHeight — Page viewport height in CSS pixels
   */
  setPageData(
    textDivs: HTMLSpanElement[],
    viewportWidth: number,
    viewportHeight: number
  ): void {
    this.pageData.push({ textDivs, viewportWidth, viewportHeight });
  }

  /** Reset all accumulated page data (for re-render). */
  clearPages(): void {
    this.pageData = [];
    this.payloads = [];
    this.lookupTable = [];
    this.fullText = "";
    this.payloadMap.clear();
    this.clearHighlight();
  }

  // ---- IDocumentAdapter implementation ----

  extractNodes(): TextNodePayload[] {
    const allPayloads: TextNodePayload[] = [];
    let globalCharIndex = 0;
    let idCounter = 0;

    for (const page of this.pageData) {
      const { textDivs, viewportWidth, viewportHeight } = page;

      if (textDivs.length === 0) continue;

      // Build sortable entries from rendered span positions
      const sortables = this.buildSortables(textDivs);
      if (sortables.length === 0) continue;

      // Y-cluster + X-sort → reading order
      const sortedIndices = this.sortByReadOrder(sortables);

      for (const si of sortedIndices) {
        const span = textDivs[si];
        if (!span) continue;

        const text = (span.textContent || "").trim();
        if (text.length === 0) continue;

        const id = `p${idCounter++}`;
        allPayloads.push({
          id,
          text,
          charIndex: globalCharIndex,
          charLength: text.length,
          domNode: span,
        });
        this.payloadMap.set(id, span);
        globalCharIndex += text.length;
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
    // Force extractNodes() to re-run if payloads are stale
    if (this.payloads.length === 0) {
      this.extractNodes();
    }
    return AdapterDefaults.extract(this);
  }

  getFullText(nodes: TextNodePayload[]): string {
    return AdapterDefaults.getFullText(nodes);
  }

  // ---- Highlight ----

  highlight(nodeIds: string[]): void {
    this.clearHighlight();

    for (const id of nodeIds) {
      const span = this.payloadMap.get(id);
      if (span) {
        span.classList.add("brave-tts-highlight");
        this.highlightedSpans.push(span);
      }
    }
  }

  clearHighlight(): void {
    for (const span of this.highlightedSpans) {
      span.classList.remove("brave-tts-highlight");
    }
    this.highlightedSpans = [];
  }

  // ---- Scroll ----

  scrollToNode(nodeId: string): void {
    const span = this.payloadMap.get(nodeId);
    if (!span) return;

    // Find the enclosing page container
    const pageContainer = span.closest(".page-container") as HTMLElement | null;
    if (pageContainer) {
      pageContainer.scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      // Fallback: scroll the span itself into view
      span.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  // ---- Private: sort algorithm ----

  /**
   * Build sortable entries from rendered spans.
   *
   * Uses the span's inline CSS `left` and `top` (set by PDF.js
   * renderTextLayer as percentage values) converted to pixel
   * positions. Also reads `offsetHeight` for font-size estimation.
   */
  private buildSortables(textDivs: HTMLSpanElement[]): SortableItem[] {
    const sortables: SortableItem[] = [];

    for (let i = 0; i < textDivs.length; i++) {
      const span = textDivs[i]!;

      // Extract position from inline style (set by PDF.js)
      const left = parseFloat(span.style.left) || 0;
      const top = parseFloat(span.style.top) || 0;
      const height = span.offsetHeight || 12;

      sortables.push({ originalIndex: i, y: top, x: left, height });
    }

    return sortables;
  }

  /**
   * Sort items into logical reading order using Y-clustering + X-sort.
   *
   * Algorithm (upstream PDF.js `sortTextItems`):
   * 1. Sort all items by Y (top to bottom)
   * 2. Group into clusters by Y proximity (tolerance = avgHeight * 0.33)
   * 3. Within each cluster, sort by X (left to right)
   * 4. Flatten: clusters by Y, items within cluster by X
   *
   * Multi-column PDFs: different columns end up in different Y clusters
   * because their line baselines don't align within the tolerance.
   */
  private sortByReadOrder(items: SortableItem[]): number[] {
    if (items.length <= 1) return items.map((s) => s.originalIndex);

    // Step 1: Sort by Y ascending
    const sorted = [...items].sort((a, b) => a.y - b.y);

    // Step 2: Cluster by Y proximity
    const clusters: SortableItem[][] = [];
    let current: SortableItem[] = [];

    for (const item of sorted) {
      if (current.length === 0) {
        current.push(item);
        continue;
      }

      const avgHeight =
        current.reduce((sum, s) => sum + s.height, 0) / current.length;
      const tolerance = Math.max(avgHeight * 0.33, 2); // min 2px tolerance
      const lastY = current[current.length - 1]!.y;

      if (Math.abs(item.y - lastY) <= tolerance) {
        // Same text row → same cluster
        current.push(item);
      } else {
        // New row starts
        clusters.push(current);
        current = [item];
      }
    }
    if (current.length > 0) clusters.push(current);

    // Step 3: Sort each cluster by X ascending
    for (const cluster of clusters) {
      cluster.sort((a, b) => a.x - b.x);
    }

    // Step 4: Flatten in order: clusters by Y, items by X
    const result: number[] = [];
    for (const cluster of clusters) {
      for (const item of cluster) {
        result.push(item.originalIndex);
      }
    }

    return result;
  }
}

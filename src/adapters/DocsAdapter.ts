// ============================================================
// DocsAdapter — Google Docs Canvas Adapter
// ============================================================
//
// Implements IDocumentAdapter for Google Docs pages.
// Google Docs renders text on a <canvas> — there are no DOM
// text nodes to walk. Instead we use a multi-mode fallback:
//
//   a11y     → SVG <rect aria-label="..."> elements (preferred)
//   closure  → Closure compiler internals from hidden iframe
//   lines    → .kix-lineview-content elements
//   words    → .kix-wordhtmlgenerator-word-node elements
//   svg      → <text>/<tspan> elements in canvas tiles
//   pages    → .kix-page-content-wrapper elements
//   plain    → innerText fallback
//
// Ported from V1 content/docs-content.js.
// Wraps the canvas-hack logic behind the IDocumentAdapter contract.
// ============================================================

import {
  IDocumentAdapter,
  AdapterDefaults,
} from "@adapters/IDocumentAdapter";
import type {
  TextNodePayload,
  LookupTable,
  AdapterOutput,
} from "@shared/types";

// ---- Constants ----

const DOCS_A11Y_RECT_SELECTOR =
  ".kix-canvas-tile-content svg>g>rect[aria-label], " +
  ".kix-canvas-tile-content svg>g[role=paragraph]>rect[aria-label]";

/** Editors / root containers for Google Docs */
const EDITOR_SELECTORS = [
  ".kix-appview-editor",
  "#docs-editor-container",
  ".docs-editor",
  ".kix-rotatingtilemanager-content",
];

const SURFACE_SELECTORS = [
  "#docs-editor-container",
  ".kix-rotatingtilemanager",
  ".kix-page",
  ".kix-page-content-wrapper",
];

const LINE_THRESHOLD_PX = 6;

const MIN_TEXT_LENGTH = 2;

// ---- Internal Types ----

interface A11yItem {
  rect: SVGRectElement;
  text: string;
  top: number;
  left: number;
  height: number;
}

interface A11yLine {
  text: string;
  rects: SVGRectElement[];
  a11yItems: A11yItem[];
  lineEl: Element | null;
}

interface DocsEntry {
  el: Element | SVGRectElement | null;
  rects: SVGRectElement[] | null;
  a11yItems: A11yItem[] | null;
  textNode: Text | null;
  start: number;
  end: number;
  text: string;
  isA11y?: boolean;
  isClosure?: boolean;
}

interface DocsContent {
  fullText: string;
  entries: DocsEntry[];
  plainMode: boolean;
  mode: "a11y" | "closure" | "lines" | "words" | "svg" | "pages" | "plain";
}

// ---- DocsAdapter Class ----

export class DocsAdapter implements IDocumentAdapter {
  readonly documentType = "docs";

  // Extracted state
  private entries: DocsEntry[] = [];
  private payloads: TextNodePayload[] = [];
  private lookupTable: LookupTable = [];
  private fullText = "";
  private extractionMode: DocsContent["mode"] = "plain";
  private a11yStyleNode: HTMLStyleElement | null = null;
  private closureMode = false;

  // Highlight state
  private activeHighlightIds = new Set<string>();
  private imposterSvgTexts: SVGTextElement[] = [];

  /** Regex for sentence splitting */
  private static readonly SENTENCE_RE = /[^.!?。！？]+[.!?。！？]?/g;

  // ============================================================
  // Text Extraction
  // ============================================================

  extractNodes(): TextNodePayload[] {
    const collected = this.collectContent();
    if (!collected) {
      this.payloads = [];
      return [];
    }

    this.entries = collected.entries;
    this.fullText = collected.fullText;
    this.extractionMode = collected.mode;
    this.closureMode = collected.mode === "closure";

    const payloads = this.buildPayloads(collected);
    this.payloads = payloads;
    return payloads;
  }

  buildLookupTable(nodes: TextNodePayload[]): LookupTable {
    this.lookupTable = AdapterDefaults.buildLookupTable(nodes);
    return this.lookupTable;
  }

  extract(): AdapterOutput {
    const nodes = this.extractNodes();
    const lookupTable = this.buildLookupTable(nodes);
    const fullText = AdapterDefaults.getFullText(nodes);
    return { nodes, lookupTable, fullText };
  }

  getFullText(nodes: TextNodePayload[]): string {
    return AdapterDefaults.getFullText(nodes);
  }

  // ============================================================
  // Highlight
  // ============================================================

  highlight(nodeIds: string[]): void {
    this.clearHighlight();
    this.activeHighlightIds = new Set(nodeIds);

    const ranges: Range[] = [];

    for (const id of nodeIds) {
      // Find the payload by ID to get charIndex/charLength
      const payload = this.payloads.find((p) => p.id === id);
      if (!payload) continue;

      const globalStart = payload.charIndex;
      const globalEnd = payload.charIndex + payload.charLength;

      const range = this.getRange(globalStart, globalEnd);
      if (range) ranges.push(range);
    }

    if (ranges.length === 0) return;

    // Prefer CSS Custom Highlight API
    if (this.supportsCssHighlights()) {
      try {
        const highlight = new Highlight(...ranges);
        CSS.highlights.set("brave-tts-docs-reading", highlight);
        return;
      } catch {
        // Fall through
      }
    }

    // No <mark> fallback for Docs — ranges may contain SVG impostor
    // elements that don't support surroundContents.
  }

  clearHighlight(): void {
    this.activeHighlightIds.clear();

    // Clear CSS Custom Highlight
    try {
      CSS.highlights?.delete("brave-tts-docs-reading");
    } catch {
      // ignore
    }

    // Remove SVG impostor text elements created during range creation
    for (const el of this.imposterSvgTexts) {
      el.remove();
    }
    this.imposterSvgTexts = [];
  }

  // ============================================================
  // Scroll
  // ============================================================

  scrollToNode(nodeId: string): void {
    if (this.closureMode) {
      this.scrollToClosureNode(nodeId);
      return;
    }

    const payload = this.payloads.find((p) => p.id === nodeId);
    if (!payload) return;

    // For a11y entries, try to find the associated line element
    const entry = this.entries.find(
      (e) =>
        payload.charIndex >= e.start && payload.charIndex < e.end
    );

    if (entry?.isA11y) {
      // Scroll the first rect or line element into view
      const el = entry.el || entry.rects?.[0];
      if (el instanceof Element) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        return;
      }
    }

    // For line/word/svg entries, use the element
    if (entry?.el instanceof Element) {
      entry.el.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }

    // Fallback: use the payload's domNode
    if (payload.domNode && payload.domNode instanceof Element) {
      payload.domNode.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }

    // Ultimate fallback: ratio-based scroll using the surface
    this.scrollByRatio(nodeId);
  }

  // ============================================================
  // Public helpers (used by content script for hover/resolve)
  // ============================================================

  /**
   * Returns the editor/surface root element for Google Docs.
   * Used by the content script to determine if a click target is inside docs.
   */
  getEditorRoot(): HTMLElement | null {
    for (const sel of EDITOR_SELECTORS) {
      const el = document.querySelector<HTMLElement>(sel);
      if (el) return el;
    }
    return document.querySelector<HTMLElement>(
      "[contenteditable='true'][role='textbox']"
    );
  }

  /** Check if an element is inside the Google Docs editor area */
  isInDocsEditor(el: Element | null): boolean {
    if (!el) return false;
    for (const sel of SURFACE_SELECTORS) {
      const root = document.querySelector(sel);
      if (root?.contains(el)) return true;
    }
    return Boolean(
      el.closest?.(
        ".kix-page, .kix-page-content-wrapper, .kix-canvas-tile-content, " +
          ".kix-rotatingtilemanager, .kix-lineview-content"
      )
    ) || Boolean(el.matches?.(DOCS_A11Y_RECT_SELECTOR));
  }

  /**
   * Get the a11y rect at a given point.
   * Temporarily enables pointer-events on a11y rects for hit testing.
   */
  getA11yRectAtPoint(x: number, y: number): SVGRectElement | null {
    this.setA11yHitTesting(true);
    const el = document.elementFromPoint(x, y);
    this.setA11yHitTesting(false);
    if (el?.matches?.(DOCS_A11Y_RECT_SELECTOR)) {
      return el as SVGRectElement;
    }
    return null;
  }

  /** Find a text entry at the given viewport coordinates */
  findEntryAtPoint(
    x: number,
    y: number
  ): { entry: DocsEntry; charIndex: number } | null {
    // Try a11y entries first
    for (const entry of this.entries) {
      if (!entry.isA11y || !entry.rects) continue;

      let minTop = Infinity;
      let maxBottom = -Infinity;
      let minLeft = Infinity;
      let maxRight = -Infinity;

      for (const rect of entry.rects) {
        const box = rect.getBoundingClientRect();
        if (!box.width && !box.height) continue;
        minTop = Math.min(minTop, box.top);
        maxBottom = Math.max(maxBottom, box.bottom);
        minLeft = Math.min(minLeft, box.left);
        maxRight = Math.max(maxRight, box.right);
        if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) {
          return { entry, charIndex: entry.start };
        }
      }

      if (
        minTop !== Infinity &&
        y >= minTop - 3 &&
        y <= maxBottom + 3 &&
        x >= minLeft - 8 &&
        x <= maxRight + 8
      ) {
        return { entry, charIndex: entry.start };
      }
    }

    // Try to get the a11y rect
    const a11yRect = this.getA11yRectAtPoint(x, y);
    if (a11yRect) {
      const entry = this.entries.find(
        (e) => e.isA11y && e.rects?.includes(a11yRect)
      );
      if (entry) return { entry, charIndex: entry.start };
    }

    // Fallback: ratio-based for closure mode
    if (this.closureMode && this.entries.length > 0) {
      const surface = document.querySelector(
        ".kix-page-paginated, .kix-rotatingtilemanager-content, .kix-appview-editor, #docs-editor-container"
      );
      if (surface) {
        const rect = surface.getBoundingClientRect();
        const ratio = Math.max(
          0,
          Math.min(1, (y - rect.top) / Math.max(1, rect.height))
        );
        const index = Math.min(
          this.entries.length - 1,
          Math.floor(ratio * this.entries.length)
        );
        const entry = this.entries[index]!;
        return { entry, charIndex: entry.start };
      }
    }

    return null;
  }

  /**
   * Get the full list of extracted entries.
   * Used by content script to resolve element-based reading start.
   */
  getEntries(): DocsEntry[] {
    return this.entries;
  }

  /** Get the current extraction mode */
  getExtractionMode(): string {
    return this.extractionMode;
  }

  /** Get the full concatenated text */
  getFullTextString(): string {
    return this.fullText;
  }

  // ============================================================
  // Private — Content Collection (Fallback Hierarchy)
  // ============================================================

  private collectContent(): DocsContent | null {
    // Mode 1: A11y — SVG rects with aria-label
    const a11y = this.tryA11yExtraction();
    if (a11y) return a11y;

    // Mode 2: Closure — hidden iframe Closure compiler internals
    const closure = this.tryClosureExtraction();
    if (closure) return closure;

    // Modes 3-7: DOM-based fallbacks
    const containers = this.getContainers();
    for (const container of containers) {
      // Mode 3: Line view elements
      const lines = this.tryLineExtraction(container);
      if (lines) return lines;

      // Mode 4: Word nodes
      const words = this.tryWordExtraction(container);
      if (words) return words;

      // Mode 5: SVG text elements
      const svg = this.trySvgExtraction(container);
      if (svg) return svg;

      // Mode 6: Page wrappers
      const pages = this.tryPageExtraction(container);
      if (pages) return pages;
    }

    // Mode 7: Plain text fallback
    const plain = this.tryPlainExtraction();
    if (plain) return plain;

    return null;
  }

  // --- Mode 1: A11y Extraction ---

  private tryA11yExtraction(): DocsContent | null {
    const containers = this.getContainers();
    for (const container of containers) {
      const rects = this.getA11yRects(container);
      if (rects.length < 2) continue;

      const lines = this.groupA11yRectsIntoLines(rects);
      if (!lines.length) continue;

      const entries: DocsEntry[] = [];
      let fullText = "";
      let cursor = 0;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (i > 0) {
          fullText += "\n";
          cursor += 1;
        }
        entries.push({
          el: line.lineEl,
          rects: line.rects,
          a11yItems: line.a11yItems,
          textNode: null,
          start: cursor,
          end: cursor + line.text.length,
          text: line.text,
          isA11y: true,
        });
        fullText += line.text;
        cursor += line.text.length;
      }

      if (fullText.trim().length >= MIN_TEXT_LENGTH) {
        return { fullText, entries, plainMode: false, mode: "a11y" };
      }
    }
    return null;
  }

  // --- Mode 2: Closure Extraction ---

  private tryClosureExtraction(): DocsContent | null {
    const extracted = this.requestDocsPageExtract();
    const rawText = this.normalizeDocsText(extracted?.text || "");
    if (rawText.trim().length < MIN_TEXT_LENGTH) return null;

    const entries: DocsEntry[] = [];
    let fullText = "";
    let cursor = 0;
    const rawLines = rawText.split("\n");

    for (const line of rawLines) {
      const text = line.trim();
      if (text.length < MIN_TEXT_LENGTH) continue;
      if (fullText.length > 0) {
        fullText += "\n";
        cursor += 1;
      }
      entries.push({
        el: null,
        rects: null,
        a11yItems: null,
        textNode: null,
        start: cursor,
        end: cursor + text.length,
        text,
        isClosure: true,
      });
      fullText += text;
      cursor += text.length;
    }

    if (fullText.trim().length < MIN_TEXT_LENGTH) return null;
    return { fullText, entries, plainMode: false, mode: "closure" };
  }

  // --- Mode 3: Line Extraction ---

  private tryLineExtraction(container: Element): DocsContent | null {
    const lineNodes = container.querySelectorAll(".kix-lineview-content");
    if (!lineNodes.length) return null;

    const result = this.collectFromElements(
      Array.from(lineNodes),
      "\n"
    );
    if (!result) return null;
    return { ...result, plainMode: false, mode: "lines" };
  }

  // --- Mode 4: Word Extraction ---

  private tryWordExtraction(container: Element): DocsContent | null {
    const wordNodes = container.querySelectorAll(
      ".kix-wordhtmlgenerator-word-node"
    );
    if (!wordNodes.length) return null;

    const result = this.collectFromElements(Array.from(wordNodes), "");
    if (!result) return null;
    return { ...result, plainMode: false, mode: "words" };
  }

  // --- Mode 5: SVG Text Extraction ---

  private trySvgExtraction(container: Element): DocsContent | null {
    const svgTextNodes = container.querySelectorAll(
      ".kix-canvas-tile-content text, .kix-canvas-tile-content tspan, .kix-a11y-text"
    );
    if (!svgTextNodes.length) return null;

    const result = this.collectFromElements(
      Array.from(svgTextNodes),
      " "
    );
    if (!result) return null;
    return { ...result, plainMode: false, mode: "svg" };
  }

  // --- Mode 6: Page Extraction ---

  private tryPageExtraction(container: Element): DocsContent | null {
    const pages = container.querySelectorAll(
      ".kix-page-content-wrapper, .kix-page"
    );
    if (!pages.length) return null;

    const result = this.collectFromElements(Array.from(pages), "\n");
    if (!result) return null;
    return { ...result, plainMode: false, mode: "pages" };
  }

  // --- Mode 7: Plain Extraction ---

  private tryPlainExtraction(): DocsContent | null {
    const hiddenContainer = this.getHiddenTextContainer();
    const plainSources: (Element | HTMLElement | null)[] = [
      hiddenContainer,
      document.querySelector(".kix-appview-editor"),
      document.querySelector(".kix-rotatingtilemanager-content"),
      document.querySelector("#docs-editor-container"),
    ];

    for (const container of plainSources) {
      if (!container) continue;
      const text = this.normalizeDocsText(
        (container as HTMLElement).innerText || ""
      );
      if (text.trim().length >= MIN_TEXT_LENGTH) {
        return {
          fullText: text,
          entries: [],
          plainMode: true,
          mode: "plain",
        };
      }
    }
    return null;
  }

  // ============================================================
  // Private — A11y Helpers
  // ============================================================

  private getA11yRects(root: Document | Element = document): SVGRectElement[] {
    this.ensureA11yStyles();
    return (
      Array.from(root.querySelectorAll(DOCS_A11Y_RECT_SELECTOR)) as SVGRectElement[]
    ).filter((rect) => {
      const label = rect.getAttribute("aria-label");
      return typeof label === "string" && label.trim().length > 0;
    });
  }

  private groupA11yRectsIntoLines(rects: SVGRectElement[]): A11yLine[] {
    const items: A11yItem[] = rects
      .map((rect) => {
        const box = rect.getBoundingClientRect();
        return {
          rect,
          text: this.normalizeDocsText(rect.getAttribute("aria-label") || ""),
          top: box.top,
          left: box.left,
          height: box.height,
        };
      })
      .filter((item) => item.text.length > 0);

    items.sort((a, b) => a.top - b.top || a.left - b.left);

    const lineGroups: { top: number; height: number; items: A11yItem[] }[] = [];
    let current: typeof lineGroups[0] | null = null;

    for (const item of items) {
      if (!current || Math.abs(item.top - current.top) > LINE_THRESHOLD_PX) {
        current = { top: item.top, height: item.height, items: [] };
        lineGroups.push(current);
      }
      current.items.push(item);
      current.top = (current.top + item.top) / 2; // running average
    }

    return lineGroups
      .map((group) => {
        group.items.sort((a, b) => a.left - b.left);
        const text = this.joinA11yRectText(
          group.items.map((item) => item.text)
        );
        const firstItem = group.items[0]!;
        const lineEl =
          firstItem.rect.closest(".kix-lineview, .kix-lineview-content") ||
          firstItem.rect;
        return {
          text,
          rects: group.items.map((item) => item.rect),
          a11yItems: group.items,
          lineEl: lineEl as Element | null,
        };
      })
      .filter((line) => line.text.length >= MIN_TEXT_LENGTH);
  }

  private joinA11yRectText(parts: string[]): string {
    return this.normalizeDocsText(parts.join(""))
      .replace(/\s+/g, " ")
      .trim();
  }

  private setA11yHitTesting(enabled: boolean): void {
    const style = this.ensureA11yStyles();
    style.disabled = !enabled;
  }

  private ensureA11yStyles(): HTMLStyleElement {
    if (this.a11yStyleNode?.isConnected) return this.a11yStyleNode;

    const style = document.createElement("style");
    style.id = "brave-tts-docs-a11y";
    style.textContent = [
      ".kix-canvas-tile-content{pointer-events:none!important;}",
      ".kix-canvas-tile-content svg>g>rect[aria-label]{pointer-events:all!important;}",
      ".kix-canvas-tile-content svg>g[role=paragraph]>rect[aria-label]{pointer-events:all!important;}",
    ].join("\n");
    (document.head || document.documentElement).appendChild(style);
    this.a11yStyleNode = style;
    return style;
  }

  // ============================================================
  // Private — Closure Extraction Helpers
  // ============================================================

  /**
   * Request text extraction from the page-context bridge script.
   * The bridge runs in the page world and can access the hidden
   * iframe's Closure compiler internals.
   */
  private requestDocsPageExtract(): {
    text: string;
    a11yRects: number;
    annotateFlag: string | null;
  } | null {
    let payload: {
      text: string;
      a11yRects: number;
      annotateFlag: string | null;
    } | null = null;

    const eventId = `brave-tts-docs-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;

    const onResult = (event: Event): void => {
      const detail = (event as CustomEvent).detail;
      if (detail?.eventId === eventId) {
        payload = {
          text: detail.text || "",
          a11yRects: detail.a11yRects || 0,
          annotateFlag: detail.annotateFlag || null,
        };
      }
    };

    window.addEventListener("brave-tts-docs-text", onResult);
    window.dispatchEvent(
      new CustomEvent("brave-tts-docs-extract", { detail: { eventId } })
    );

    // The page bridge handler runs synchronously (it currently does in V1).
    // If payload is still null, keep listener alive briefly as safety net.
    if (payload !== null) {
      window.removeEventListener("brave-tts-docs-text", onResult);
    } else {
      setTimeout(
        () => window.removeEventListener("brave-tts-docs-text", onResult),
        100
      );
    }
    return payload;
  }

  // ============================================================
  // Private — DOM-based Collection Helpers
  // ============================================================

  private collectFromElements(
    elements: Element[],
    joiner: string
  ): { fullText: string; entries: DocsEntry[] } | null {
    const entries: DocsEntry[] = [];
    let fullText = "";
    let cursor = 0;
    let added = 0;

    for (const el of elements) {
      const text = this.normalizeDocsText(el.textContent || "");
      if (!text) continue;
      if (added > 0 && joiner) {
        fullText += joiner;
        cursor += joiner.length;
      }
      const textNode = Array.from(el.childNodes).find(
        (n) => n.nodeType === Node.TEXT_NODE
      ) as Text | null;
      entries.push({
        el,
        textNode,
        rects: null,
        a11yItems: null,
        start: cursor,
        end: cursor + text.length,
        text,
      });
      fullText += text;
      cursor += text.length;
      added += 1;
    }

    return added > 0 && fullText.trim().length >= MIN_TEXT_LENGTH
      ? { fullText, entries }
      : null;
  }

  // ============================================================
  // Private — Payload Building
  // ============================================================

  private buildPayloads(collected: DocsContent): TextNodePayload[] {
    const segments = this.splitIntoSegments(collected);
    const payloads: TextNodePayload[] = [];
    let idCounter = 0;

    for (const seg of segments) {
      const id = `d${idCounter++}`;
      payloads.push({
        id,
        text: seg.text,
        charIndex: seg.charIndex,
        charLength: seg.charLength,
        domNode: seg.domNode ?? null,
        rects: seg.rects ?? null,
      });
    }

    return payloads;
  }

  /**
   * Split extracted content into sentence-level segments.
   * Matches V1's buildGoogleDocsLineSegments + splitDocsIntoSegments logic.
   */
  private splitIntoSegments(collected: DocsContent): {
    text: string;
    charIndex: number;
    charLength: number;
    domNode?: Node | null;
    rects?: DOMRect[] | null;
  }[] {
    const segments: {
      text: string;
      charIndex: number;
      charLength: number;
      domNode?: Node | null;
      rects?: DOMRect[] | null;
    }[] = [];

    // For a11y/closure/lines entries, split each entry into sentences
    if (collected.entries.length > 0) {
      for (const entry of collected.entries) {
        const lineText = entry.text.trim();
        if (lineText.length < MIN_TEXT_LENGTH) continue;

        const parts =
          lineText.match(DocsAdapter.SENTENCE_RE) || [lineText];
        let localFrom = 0;

        for (const part of parts) {
          const text = part.trim();
          if (text.length < MIN_TEXT_LENGTH) continue;
          const localIdx = entry.text.indexOf(part, localFrom);
          if (localIdx < 0) continue;

          const domNode =
            entry.textNode ||
            entry.el ||
            entry.rects?.[0] ||
            null;
          const rects: DOMRect[] | null = entry.rects
            ? entry.rects
                .map((r) => r.getBoundingClientRect())
                .filter((b) => b.width > 0 || b.height > 0)
            : null;

          segments.push({
            text,
            charIndex: entry.start + localIdx,
            charLength: part.length,
            domNode,
            rects,
          });
          localFrom = localIdx + part.length;
        }
      }
    }

    // If no entries (plain mode), split the full text
    if (!segments.length && collected.fullText.trim().length >= MIN_TEXT_LENGTH) {
      const parts =
        collected.fullText.match(DocsAdapter.SENTENCE_RE) ||
        [collected.fullText];
      let searchFrom = 0;

      for (const part of parts) {
        const text = part.trim();
        if (text.length < MIN_TEXT_LENGTH) continue;
        const idx = collected.fullText.indexOf(part, searchFrom);
        if (idx === -1) continue;

        segments.push({
          text,
          charIndex: idx,
          charLength: part.length,
        });
        searchFrom = idx + part.length;
      }

      // Ultimate fallback
      if (!segments.length) {
        const text = collected.fullText.trim();
        segments.push({
          text,
          charIndex: 0,
          charLength: text.length,
        });
      }
    }

    return segments;
  }

  // ============================================================
  // Private — Range Creation (for Highlight)
  // ============================================================

  /**
   * Create a DOM Range for a given character range in the full text.
   * Ported from V1 getGoogleDocsRange().
   */
  private getRange(
    globalStart: number,
    globalEnd: number
  ): Range | null {
    // Strategy 1: Use entries for precise offset mapping
    if (this.entries.length > 0) {
      const startEntry = this.entries.find(
        (e) => globalStart >= e.start && globalStart <= e.end
      );

      if (startEntry?.isA11y) {
        return this.createA11yRange(startEntry, globalStart, globalEnd);
      }

      // Non-a11y entries — build range from text nodes or elements
      const range = document.createRange();
      let startSet = false;

      for (const entry of this.entries) {
        if (entry.isA11y) continue;

        if (!startSet && globalStart >= entry.start && globalStart <= entry.end) {
          const node = entry.textNode || entry.el;
          const offset = entry.textNode
            ? Math.min(
                entry.textNode.textContent?.length ?? 0,
                globalStart - entry.start
              )
            : 0;
          if (node) {
            range.setStart(node, offset);
            startSet = true;
          }
        }

        if (startSet && globalEnd >= entry.start && globalEnd <= entry.end) {
          const node = entry.textNode || entry.el;
          const offset = entry.textNode
            ? Math.min(
                entry.textNode.textContent?.length ?? 0,
                globalEnd - entry.start
              )
            : (entry.el?.childNodes.length || 0);
          if (node) {
            range.setEnd(node, offset);
            return range;
          }
        }
      }
    }

    // Strategy 2: Walk the editor's text nodes (TreeWalker fallback)
    const editor = this.getEditorRootForRange();
    if (!editor) return null;

    try {
      const range = document.createRange();
      const walker = document.createTreeWalker(
        editor,
        NodeFilter.SHOW_TEXT
      );
      let cursor = 0;
      let startNode: Text | null = null;
      let startOffset = 0;
      let endNode: Text | null = null;
      let endOffset = 0;

      let n: Node | null;
      while ((n = walker.nextNode())) {
        const textNode = n as Text;
        const len = textNode.textContent?.length ?? 0;
        const nextCursor = cursor + len;

        if (!startNode && globalStart >= cursor && globalStart <= nextCursor) {
          startNode = textNode;
          startOffset = Math.max(0, globalStart - cursor);
        }

        if (startNode && globalEnd >= cursor && globalEnd <= nextCursor) {
          endNode = textNode;
          endOffset = Math.max(0, globalEnd - cursor);
          break;
        }

        cursor = nextCursor;
      }

      if (startNode && endNode) {
        range.setStart(startNode, startOffset);
        range.setEnd(endNode, endOffset);
        return range;
      }
    } catch {
      // ignore
    }

    return null;
  }

  /**
   * Create a Range for an a11y entry by generating an SVG <text> impostor.
   * Google Docs renders text on canvas; SVG rects have aria-labels but
   * no text nodes. We create a temporary SVG text to host the Range.
   *
   * Ported from V1 createA11yTextRange().
   */
  private createA11yRange(
    entry: DocsEntry,
    globalStart: number,
    globalEnd: number
  ): Range | null {
    const anchorRect = entry.rects?.[0];
    if (!anchorRect || !entry.text) return null;

    const localStart = Math.max(0, globalStart - entry.start);
    const localEnd = Math.min(entry.text.length, globalEnd - entry.start);

    try {
      const clampedStart = Math.max(0, Math.min(localStart, entry.text.length));
      const clampedEnd = Math.max(
        clampedStart,
        Math.min(localEnd, entry.text.length)
      );

      if (clampedStart >= clampedEnd) {
        return null;
      }

      const content = document.createTextNode(entry.text);
      const svgText = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "text"
      );

      // Copy positioning attributes from the source rect
      const transform = anchorRect.getAttribute("transform") || "";
      const font = anchorRect.getAttribute("data-font-css") || "";
      const elementX = anchorRect.getAttribute("x");
      const elementY = anchorRect.getAttribute("y");
      if (elementX) svgText.setAttribute("x", elementX);
      if (elementY) svgText.setAttribute("y", elementY);

      svgText.appendChild(content);
      svgText.dataset.braveTtsImposter = "1";
      svgText.style.setProperty("all", "initial", "important");
      svgText.style.setProperty("transform", transform, "important");
      svgText.style.setProperty("font", font, "important");
      svgText.style.setProperty("text-anchor", "start", "important");
      svgText.style.setProperty("pointer-events", "none", "important");
      svgText.style.setProperty("opacity", "0", "important");

      const parent = anchorRect.parentNode;
      if (!parent) return null;
      parent.appendChild(svgText);

      // Track for cleanup
      this.imposterSvgTexts.push(svgText);

      // Adjust vertical positioning to match the source rect
      const elementRect = anchorRect.getBoundingClientRect();
      const textRect = svgText.getBoundingClientRect();
      if (textRect.height > 0) {
        const yOffset =
          (elementRect.top - textRect.top + (elementRect.bottom - textRect.bottom)) *
          0.5;
        svgText.style.setProperty(
          "transform",
          `translate(0px,${yOffset}px) ${transform}`,
          "important"
        );
      }

      const range = document.createRange();
      range.setStart(content, clampedStart);
      range.setEnd(content, clampedEnd);
      return range;
    } catch {
      return null;
    }
  }

  // ============================================================
  // Private — Scroll Helpers
  // ============================================================

  /**
   * Scroll to a node in closure mode using ratio-based positioning.
   * Closure mode has no DOM nodes — we estimate position by index ratio
   * relative to the editor surface.
   */
  private scrollToClosureNode(nodeId: string): void {
    if (!this.entries.length) return;

    const payload = this.payloads.find((p) => p.id === nodeId);
    if (!payload) return;

    // Find which entry contains this payload
    const entryIndex = this.entries.findIndex(
      (e) =>
        payload.charIndex >= e.start && payload.charIndex < e.end
    );
    if (entryIndex < 0) return;

    const surface = document.querySelector(
      ".kix-page-paginated, .kix-rotatingtilemanager-content, .kix-appview-editor"
    );
    if (!surface) return;

    const rect = surface.getBoundingClientRect();
    const ratio =
      entryIndex / Math.max(1, this.entries.length - 1);
    const targetY =
      window.scrollY + rect.top + ratio * rect.height - window.innerHeight * 0.35;

    window.scrollTo({ top: Math.max(0, targetY), behavior: "smooth" });
  }

  /**
   * Fallback scroll: ratio-based using the payload index among all payloads.
   */
  private scrollByRatio(nodeId: string): void {
    const idx = this.payloads.findIndex((p) => p.id === nodeId);
    if (idx < 0 || this.payloads.length === 0) return;

    const surface = document.querySelector(
      ".kix-page-paginated, .kix-rotatingtilemanager-content, .kix-appview-editor, #docs-editor-container"
    );
    if (!surface) return;

    const rect = surface.getBoundingClientRect();
    const ratio = idx / Math.max(1, this.payloads.length - 1);
    const targetY =
      window.scrollY + rect.top + ratio * rect.height - window.innerHeight * 0.35;

    window.scrollTo({ top: Math.max(0, targetY), behavior: "smooth" });
  }

  // ============================================================
  // Private — Utility Helpers
  // ============================================================

  private normalizeDocsText(text: string): string {
    return (text || "")
      .replace(/​/g, "")
      .replace(/\r/g, "")
      .replace(/\s+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n");
  }

  private getEditorRootForRange(): HTMLElement | null {
    return (
      document.querySelector(".kix-appview-editor") ||
      document.querySelector("#docs-editor-container") ||
      document.querySelector(".docs-editor") ||
      document.querySelector(".kix-rotatingtilemanager-content")
    );
  }

  private getContainers(): Element[] {
    return [
      document.querySelector(".kix-rotatingtilemanager-content"),
      this.getEditorRoot(),
      document.querySelector("#docs-editor-container"),
    ].filter(Boolean) as Element[];
  }

  private getHiddenTextContainer(): HTMLElement | null {
    const iframe = document.querySelector(
      "iframe.docs-texteventtarget-iframe"
    ) as HTMLIFrameElement | null;
    try {
      const body = iframe?.contentDocument?.body;
      if (
        body &&
        this.normalizeDocsText(body.innerText || "").trim().length >=
          MIN_TEXT_LENGTH
      ) {
        return body;
      }
    } catch {
      /* cross-origin or unavailable */
    }
    return null;
  }

  private supportsCssHighlights(): boolean {
    try {
      return (
        typeof CSS !== "undefined" &&
        !!CSS.highlights &&
        typeof Highlight !== "undefined"
      );
    } catch {
      return false;
    }
  }
}

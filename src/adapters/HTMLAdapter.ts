// ============================================================
// HTMLAdapter — Standard HTML page text extraction
// ============================================================
//
// Implements IDocumentAdapter for standard HTML pages (not
// Google Docs, PDF, or EPUB — those have their own adapters).
//
// Strategy:
// 1. TreeWalker over visible text nodes (filtering script/style/etc.)
// 2. Find the best readable root (article, main, content selectors)
// 3. Split each text node's content into sentences via regex
// 4. Build TextNodePayload[] + LookupTable + fullText
// 5. Highlight via CSS Custom Highlight API (fallback: <mark> elements)
//
// Ported from V1 content.js: collectTextNodes(), splitIntoSegments(),
// supportsCssHighlights(), safeSetHighlight().

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

const SKIP_TAGS = new Set([
  "SCRIPT", "STYLE", "NOSCRIPT", "SVG", "CANVAS", "IFRAME",
  "OBJECT", "EMBED", "VIDEO", "AUDIO", "INPUT", "TEXTAREA",
  "SELECT", "BUTTON",
]);

const CONTENT_SELECTORS = [
  "[data-testid='content']",
  ".rich-lfc-content",
  "[itemprop='articleBody']",
  ".post-content",
  ".article-body",
  ".article-content",
  ".entry-content",
  "#content",
  "article",
  "main",
  "[role='main']",
];

const EXCLUDED_PARENTS = [
  "nav", "header", "footer", "aside",
  "[role='navigation']", "[role='banner']", "[role='contentinfo']",
];

/** Regex for sentence splitting (supports .!? and CJK punctuation) */
const SENTENCE_RE = /[^.!?。！？]+[.!?。！？]?/g;

/** Minimum text length to consider a node readable */
const MIN_TEXT_LENGTH = 2;

// ---- Internal state ----

interface NodeOffsetInfo {
  node: Text;
  startInNode: number;
  endInNode: number;
}

// ---- HTMLAdapter Class ----

export class HTMLAdapter implements IDocumentAdapter {
  readonly documentType = "html";

  private root: HTMLElement | null = null;
  private payloads: TextNodePayload[] = [];
  private lookupTable: LookupTable = [];
  private fullText = "";

  /** Maps payload ID → local offsets within the Text node (for Range creation) */
  private offsetMap = new Map<string, NodeOffsetInfo>();

  /** Currently highlighted node IDs (for clearing) */
  private activeHighlightIds = new Set<string>();

  /** <mark> elements created as fallback (for clearHighlight) */
  private markElements: HTMLElement[] = [];

  /** CSS Custom Highlight API object — created once & reused across highlight() calls */
  private highlightObject: Highlight | null = null;

  /** Cache of Range objects keyed by payload ID — avoids GC pressure from repeated allocation */
  private activeRanges = new Map<string, Range>();

  /** Whether the Highlight has been registered with CSS.highlights */
  private highlightRegistered = false;

  constructor() {
    if (this.supportsCssHighlights()) {
      this.highlightObject = new Highlight();
    }
  }

  // ---- Visibility helpers ----

  private isVisible(el: Element): boolean {
    try {
      const style = window.getComputedStyle(el);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.opacity === "0"
      ) {
        return false;
      }
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    } catch {
      return false;
    }
  }

  private isExcluded(el: Element): boolean {
    if (!el) return true;

    // Check excluded parents
    for (const sel of EXCLUDED_PARENTS) {
      if (el.closest(sel)) return true;
    }

    // Skip interactive elements
    if (el.closest("a, button, [role='button'], [role='tab']")) return true;

    // Skip our own UI
    if (el.closest(".brave-tts-toolbar, .brave-tts-play-here")) return true;

    return false;
  }

  // ---- Root detection ----

  /** Find the best readable root element, falling back to document.body */
  private findReadableRoot(): HTMLElement {
    // Check for Docs adapter — if active, let DocsAdapter handle it
    if (window.location.hostname === "docs.google.com") {
      return document.body;
    }

    for (const sel of CONTENT_SELECTORS) {
      const el = document.querySelector<HTMLElement>(sel);
      if (
        el &&
        this.isVisible(el) &&
        (el.innerText?.trim().length ?? 0) > 30
      ) {
        return el;
      }
    }
    return document.body;
  }

  // ---- TreeWalker extraction ----

  /**
   * Walk the DOM tree and collect visible, non-excluded Text nodes.
   * Each Text node is then split into sentence-level payloads.
   */
  extractNodes(): TextNodePayload[] {
    this.root = this.findReadableRoot();

    const walker = document.createTreeWalker(
      this.root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node: Node): number => {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
          if (this.isExcluded(parent)) return NodeFilter.FILTER_REJECT;
          if (!this.isVisible(parent)) return NodeFilter.FILTER_REJECT;

          const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
          if (!text || text.length < MIN_TEXT_LENGTH) {
            return NodeFilter.FILTER_REJECT;
          }

          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );

    const textNodes: Text[] = [];
    let n: Node | null;
    while ((n = walker.nextNode())) {
      textNodes.push(n as Text);
    }

    // Split each text node into sentence payloads
    this.offsetMap.clear();
    this.activeRanges.clear(); // Invalidate cached ranges — DOM may have changed
    const payloads: TextNodePayload[] = [];
    let globalIndex = 0;
    let idCounter = 0;

    for (const node of textNodes) {
      const raw = node.textContent ?? "";
      const parts = raw.match(SENTENCE_RE);

      if (!parts) continue;

      let searchFrom = 0;
      for (const part of parts) {
        const text = part.trim();
        if (text.length < MIN_TEXT_LENGTH) continue;

        const idx = raw.indexOf(part, searchFrom);
        if (idx === -1) continue;

        const endIdx = idx + part.length;
        const id = `h${idCounter++}`;

        payloads.push({
          id,
          text,
          charIndex: globalIndex,
          charLength: text.length,
          domNode: node,
        });

        this.offsetMap.set(id, {
          node,
          startInNode: idx,
          endInNode: endIdx,
        });

        globalIndex += text.length;
        searchFrom = endIdx;
      }
    }

    this.payloads = payloads;
    this.fullText = payloads.map((p) => p.text).join("");
    return payloads;
  }

  // ---- LookupTable ----

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

  // ---- Highlight ----

  highlight(nodeIds: string[]): void {
    this.clearHighlight();
    this.activeHighlightIds = new Set(nodeIds);

    // Lazy one-time registration of the Highlight object with CSS.highlights
    if (this.highlightObject && !this.highlightRegistered) {
      try {
        CSS.highlights.set("brave-tts-reading", this.highlightObject);
        this.highlightRegistered = true;
      } catch {
        // ignore
      }
    }

    // CSS Custom Highlight path — reuse cached Ranges and shared Highlight object
    if (this.highlightObject) {
      for (const id of nodeIds) {
        const offset = this.offsetMap.get(id);
        if (!offset) continue;

        try {
          let range = this.activeRanges.get(id);
          if (range) {
            // Update existing range boundaries — no GC allocation
            range.setStart(offset.node, offset.startInNode);
            range.setEnd(offset.node, offset.endInNode);
          } else {
            // First time seeing this ID: create Range and cache it
            range = document.createRange();
            range.setStart(offset.node, offset.startInNode);
            range.setEnd(offset.node, offset.endInNode);
            this.activeRanges.set(id, range);
          }
          this.highlightObject.add(range);
        } catch {
          // Node may have been removed from the DOM — evict stale cache entry
          this.activeRanges.delete(id);
        }
      }
      return;
    }

    // <mark> fallback — build fresh ranges (surroundContents mutates DOM, so caching not useful)
    const ranges: Range[] = [];
    for (const id of nodeIds) {
      const offset = this.offsetMap.get(id);
      if (!offset) continue;

      try {
        const range = document.createRange();
        range.setStart(offset.node, offset.startInNode);
        range.setEnd(offset.node, offset.endInNode);
        ranges.push(range);
      } catch {
        // Node may have been removed
      }
    }

    if (ranges.length === 0) return;
    this.applyMarkFallback(ranges);
  }

  clearHighlight(): void {
    this.activeHighlightIds.clear();

    // Clear ranges from the shared Highlight object (keep it registered)
    if (this.highlightObject) {
      this.highlightObject.clear();
    }

    // Clear <mark> elements
    for (const mark of this.markElements) {
      const parent = mark.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(mark.textContent ?? ""), mark);
        parent.normalize();
      }
    }
    this.markElements = [];
  }

  /**
   * Full cleanup: remove Highlight from CSS.highlights, clear all caches,
   * and reset adapter state. Call when the adapter is no longer needed
   * (e.g. on STOP_READING or before starting a new reading session).
   */
  destroy(): void {
    this.clearHighlight();

    // Remove from CSS.highlights registry
    if (this.highlightRegistered) {
      try {
        CSS.highlights.delete("brave-tts-reading");
      } catch {
        // ignore
      }
      this.highlightRegistered = false;
    }

    // Clear Range cache
    this.activeRanges.clear();

    // Reset internal state
    this.offsetMap.clear();
    this.payloads = [];
    this.lookupTable = [];
    this.fullText = "";
    this.root = null;
    this.highlightObject = null;
  }

  // ---- Scroll ----

  scrollToNode(nodeId: string): void {
    const offset = this.offsetMap.get(nodeId);
    if (!offset) return;

    try {
      const range = document.createRange();
      range.setStart(offset.node, offset.startInNode);
      range.setEnd(offset.node, offset.endInNode);
      const rect = range.getBoundingClientRect();
      if (rect && rect.top < 0) {
        offset.node.parentElement?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      } else if (rect && rect.bottom > window.innerHeight) {
        offset.node.parentElement?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }
      range.detach();
    } catch {
      // Node removed
    }
  }

  // ---- Private helpers ----

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

  /**
   * Fallback: wrap each range in a <mark class="brave-tts-highlight"> element.
   * Restores original text nodes on clearHighlight().
   */
  private applyMarkFallback(ranges: Range[]): void {
    for (const range of ranges) {
      try {
        const mark = document.createElement("mark");
        mark.className = "brave-tts-highlight";
        range.surroundContents(mark);
        this.markElements.push(mark);
      } catch {
        // Range may cross element boundaries — surroundContents fails.
        // In that case, skip this range.
      }
    }
  }
}

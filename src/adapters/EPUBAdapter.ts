// ============================================================
// EPUBAdapter — EPUB chapter text extraction via epub.js
// ============================================================
//
// Implements IDocumentAdapter for EPUB documents rendered by
// epub.js. Each chapter is rendered in an iframe; the adapter
// walks the chapter Document, extracts text nodes, and builds
// a LookupTable.
//
// Strategy (see DECISIONS.md § "EPUB dùng rendition events"):
// 1. setContents(contents) called on each chapter transition
// 2. TreeWalker the chapterDocument for visible text nodes
// 3. Split into sentence-level payloads
// 4. Highlight via CSS injection (contents.addStylesheetCss)
// 5. CFI mapping for precise positions
//
// No content script in the iframe — CSS injection is direct.

import { IDocumentAdapter } from "@adapters/IDocumentAdapter";
import type {
  TextNodePayload,
  LookupTable,
  AdapterOutput,
} from "@shared/types";

// ---- Constants ----

const SKIP_TAGS = new Set([
  "SCRIPT", "STYLE", "NOSCRIPT", "SVG", "CANVAS",
  "OBJECT", "EMBED", "VIDEO", "AUDIO", "INPUT",
  "TEXTAREA", "SELECT", "BUTTON",
]);

const SENTENCE_RE = /[^.!?。！？]+[.!?。！？]?/g;
const MIN_TEXT_LENGTH = 2;

const HIGHLIGHT_STYLESHEET_KEY = "brave-tts-epub";

// ---- Internal state ----

interface NodeOffsetInfo {
  node: Text;
  startInNode: number;
  endInNode: number;
}

// ---- EPUBAdapter Class ----

export class EPUBAdapter implements IDocumentAdapter {
  readonly documentType = "epub";

  /** epub.js Contents reference (minimal interface for what we need) */
  private contents: {
    document: Document;
    addStylesheetCss?: (css: string, key: string) => Promise<boolean>;
  } | null = null;
  private chapterDoc: Document | null = null;
  private payloads: TextNodePayload[] = [];
  private lookupTable: LookupTable = [];
  private fullText = "";
  private offsetMap = new Map<string, NodeOffsetInfo>();
  private activeHighlightIds = new Set<string>();

  // ---- Lifecycle ----

  /**
   * Called by the viewer when a chapter is rendered or
   * relocated. The `contents` object is the epub.js Contents
   * instance holding the current chapter's document.
   */
  setContents(contents: EPUBAdapter["contents"]): void {
    if (!contents) return;
    this.clearHighlight();
    this.contents = contents;
    this.chapterDoc = contents.document;
    this.offsetMap.clear();
    this.payloads = [];
    this.lookupTable = [];
    this.fullText = "";
    this.activeHighlightIds.clear();
  }

  /** The current chapter document (null if no chapter loaded) */
  get document(): Document | null {
    return this.chapterDoc;
  }

  // ---- IDocumentAdapter Implementation ----

  extractNodes(): TextNodePayload[] {
    const doc = this.chapterDoc;
    if (!doc) return [];

    const walker = doc.createTreeWalker(
      doc.body || doc.documentElement,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node: Node): number => {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
          const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
          if (!text || text.length < MIN_TEXT_LENGTH) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );

    const textNodes: Text[] = [];
    let n: Node | null;
    while ((n = walker.nextNode())) {
      textNodes.push(n as Text);
    }

    this.offsetMap.clear();
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
        const id = `e${idCounter++}`;

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

  buildLookupTable(nodes: TextNodePayload[]): LookupTable {
    this.lookupTable = nodes.map((n) => ({
      charIndex: n.charIndex,
      nodeId: n.id,
    }));
    return this.lookupTable;
  }

  extract(): AdapterOutput {
    const nodes = this.extractNodes();
    const lookupTable = this.buildLookupTable(nodes);
    const fullText = nodes.map((n) => n.text).join("");
    return { nodes, lookupTable, fullText };
  }

  getFullText(nodes: TextNodePayload[]): string {
    return nodes.map((n) => n.text).join("");
  }

  // ---- Highlight (CSS injection) ----

  highlight(nodeIds: string[]): void {
    this.clearHighlight();
    this.activeHighlightIds = new Set(nodeIds);

    const doc = this.chapterDoc;
    if (!doc) return;

    // Build CSS rules for each highlighted node
    const selectors: string[] = [];
    let markIndex = 0;

    for (const id of nodeIds) {
      const offset = this.offsetMap.get(id);
      if (!offset) continue;

      try {
        const range = doc.createRange();
        range.setStart(offset.node, offset.startInNode);
        range.setEnd(offset.node, offset.endInNode);

        // Wrap in a span with a unique data attribute
        const span = doc.createElement("span");
        span.setAttribute("data-brave-tts-hl", `e${markIndex}`);
        range.surroundContents(span);
        selectors.push(`[data-brave-tts-hl="e${markIndex}"]`);
        markIndex++;
      } catch {
        // Range.surroundContents can fail for complex boundaries.
        // In that case, skip this node.
      }
    }

    // Inject highlight CSS into the chapter document
    if (selectors.length > 0) {
      const css = `
        ${selectors.join(",\n")} {
          background-color: rgba(255, 213, 79, 0.5) !important;
          color: inherit !important;
        }
      `;

      // Try epub.js Contents.addStylesheetCss for proper scoping
      if (this.contents?.addStylesheetCss) {
        this.contents.addStylesheetCss(css, HIGHLIGHT_STYLESHEET_KEY);
      } else {
        // Fallback: inject directly into chapter document head
        const style = doc.createElement("style");
        style.setAttribute("data-brave-tts", HIGHLIGHT_STYLESHEET_KEY);
        style.textContent = css;
        doc.head?.appendChild(style);
      }
    }
  }

  clearHighlight(): void {
    this.activeHighlightIds.clear();

    const doc = this.chapterDoc;
    if (!doc) return;

    // Remove injected highlight spans (unwrap them)
    const spans = doc.querySelectorAll("[data-brave-tts-hl]");
    for (const span of spans) {
      const parent = span.parentNode;
      if (parent) {
        while (span.firstChild) {
          parent.insertBefore(span.firstChild, span);
        }
        parent.removeChild(span);
      }
    }
    // Normalize to merge adjacent text nodes
    doc.body?.normalize();

    // Remove injected stylesheet via epub.js Contents
    if (this.contents?.addStylesheetCss) {
      this.contents.addStylesheetCss("", HIGHLIGHT_STYLESHEET_KEY);
    }

    // Remove directly injected style elements
    const styles = doc.querySelectorAll(
      `style[data-brave-tts="${HIGHLIGHT_STYLESHEET_KEY}"]`
    );
    for (const style of styles) {
      style.remove();
    }
  }

  // ---- Scroll ----

  scrollToNode(nodeId: string): void {
    const doc = this.chapterDoc;
    if (!doc) return;

    const offset = this.offsetMap.get(nodeId);
    if (!offset) return;

    try {
      const range = doc.createRange();
      range.setStart(offset.node, offset.startInNode);
      range.setEnd(offset.node, offset.endInNode);
      const rect = range.getBoundingClientRect();
      range.detach();

      if (rect) {
        const win = doc.defaultView;
        if (win) {
          const scrollTop =
            rect.top + win.scrollY - win.innerHeight / 3;
          win.scrollTo({ top: Math.max(0, scrollTop), behavior: "smooth" });
        }
      }
    } catch {
      // Node may have been removed
    }
  }
}

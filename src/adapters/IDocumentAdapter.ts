// ============================================================
// IDocumentAdapter — Core Adapter Contract
// ============================================================
//
// Every document type (HTML, PDF, EPUB, Google Docs) MUST
// implement this interface. The adapter isolates format-specific
// extraction logic behind a uniform contract.
//
// See DECISIONS.md § "Adapter Pattern" for rationale.

import type {
  TextNodePayload,
  LookupTable,
  AdapterOutput,
} from "@shared/types";

export interface IDocumentAdapter {
  /** Human-readable document type identifier (e.g. "html", "pdf", "epub", "docs") */
  readonly documentType: string;

  /**
   * Walk the document and extract all readable text nodes.
   * Returns nodes sorted by reading order (charIndex ascending).
   * The adapter decides what constitutes a "segment" —
   * sentences for HTML, text-layer spans for PDF, CFI-anchored
   * fragments for EPUB, canvas-annotated blocks for Docs.
   */
  extractNodes(): TextNodePayload[];

  /**
   * Build a binary-searchable lookup table from the nodes.
   * Entry i maps charIndex → nodeId for node i.
   * Sorted by charIndex ascending.
   */
  buildLookupTable(nodes: TextNodePayload[]): LookupTable;

  /**
   * Convenience: extract + build table + join text → single call.
   * Default implementation is provided but adapters MAY override
   * for performance (e.g. single-pass extraction).
   */
  extract(): AdapterOutput;

  /**
   * Highlight the given node IDs in the document.
   * Implementations SHOULD use CSS Custom Highlight API when
   * available, falling back to Shadow-DOM-based highlights.
   */
  highlight(nodeIds: string[]): void;

  /** Remove all highlights applied by this adapter. */
  clearHighlight(): void;

  /**
   * Scroll the given node into view.
   * Used for auto-scroll during playback and back-on-track.
   */
  scrollToNode(nodeId: string): void;

  /**
   * Get the full concatenated text from a set of nodes.
   * Default: joins node.text in array order.
   */
  getFullText(nodes: TextNodePayload[]): string;
}

/**
 * Default mixed-in implementations usable by concrete adapters.
 * Usage: `class HTMLAdapter implements IDocumentAdapter { ... }`
 * Then spread or call these helpers where the default logic suffices.
 */

export const AdapterDefaults = {
  buildLookupTable(nodes: TextNodePayload[]): LookupTable {
    const table: LookupTable = [];
    for (const node of nodes) {
      table.push({ charIndex: node.charIndex, nodeId: node.id });
    }
    return table;
  },

  extract(
    adapter: Pick<
      IDocumentAdapter,
      "documentType" | "extractNodes" | "buildLookupTable" | "getFullText"
    >
  ): AdapterOutput {
    const nodes = adapter.extractNodes();
    const lookupTable = adapter.buildLookupTable(nodes);
    const fullText = adapter.getFullText(nodes);
    // Sort by charIndex to guarantee binary-search correctness
    nodes.sort((a, b) => a.charIndex - b.charIndex);
    lookupTable.sort((a, b) => a.charIndex - b.charIndex);
    return { nodes, lookupTable, fullText };
  },

  getFullText(nodes: TextNodePayload[]): string {
    return nodes.map((n) => n.text).join("");
  },

  /** Binary search: find nodeId for a given charIndex */
  findNodeId(table: LookupTable, charIndex: number): string | null {
    let lo = 0;
    let hi = table.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const entry = table[mid]!;
      const nextEntry = table[mid + 1];
      if (
        entry.charIndex <= charIndex &&
        (!nextEntry || charIndex < nextEntry.charIndex)
      ) {
        return entry.nodeId;
      }
      if (charIndex < entry.charIndex) {
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }
    return null;
  },
};

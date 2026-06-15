// ============================================================
// EPUB Viewer Page — V2-03 Stub
// ============================================================
//
// Placeholder viewer that receives the document URL via hash
// fragment (`#url=...`) or query param (`?url=...`), validates
// it's an EPUB, and displays a "coming soon" message.
//
// Integration point for v2-06 (epub.js rendering + EPUBAdapter).
//
// 4 states:
//   loading     — Extracting URL + validating type
//   ready       — URL validated, document info displayed
//   error       — No URL provided
//   unsupported — URL does not point to an EPUB

import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { extractOriginalUrl, detectDocumentType } from "@shared/interception";

type ViewerState = "loading" | "ready" | "error" | "unsupported";

// ---- Styles ----

const toolbarStyle: React.CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  right: 0,
  zIndex: 100,
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "8px 16px",
  background: "#1a1a2e",
  color: "#fff",
  fontSize: 13,
};

const titleStyle: React.CSSProperties = {
  flex: 1,
  fontWeight: 600,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const centerStyle: React.CSSProperties = {
  marginTop: 44,
  flex: 1,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  padding: 40,
  textAlign: "center" as const,
};

const urlDisplayStyle: React.CSSProperties = {
  fontSize: 13,
  opacity: 0.7,
  marginBottom: 8,
  maxWidth: 600,
  wordBreak: "break-all" as const,
};

// ---- Component ----

function EpubViewerApp(): React.ReactElement {
  const [state, setState] = useState<ViewerState>("loading");
  const [documentUrl, setDocumentUrl] = useState<string>("");

  useEffect(() => {
    const url = extractOriginalUrl();

    if (!url) {
      setState("error");
      return;
    }

    const docType = detectDocumentType(url);
    if (docType !== "epub") {
      setState("unsupported");
      return;
    }

    setDocumentUrl(url);
    // v2-06 integration point: load epub.js here
    setState("ready");
  }, []);

  return (
    <div>
      {/* Toolbar */}
      <div style={toolbarStyle}>
        <span style={titleStyle}>
          {state === "loading"
            ? "Loading..."
            : "Brave Read Aloud — EPUB Viewer"}
        </span>
        <span style={{ fontSize: 12, opacity: 0.7 }}>
          {state === "ready" ? "Alpha" : ""}
        </span>
      </div>

      {/* Content */}
      <div style={centerStyle}>
        {state === "loading" && (
          <>
            <div style={{ fontSize: 18, marginBottom: 8 }}>
              Loading EPUB viewer...
            </div>
            <div style={{ fontSize: 13, opacity: 0.6 }}>
              Extracting document information
            </div>
          </>
        )}

        {state === "ready" && (
          <>
            <div style={{ fontSize: 24, marginBottom: 16, fontWeight: 600 }}>
              EPUB Viewer
            </div>
            <div style={{ fontSize: 14, opacity: 0.8, marginBottom: 24 }}>
              EPUB reading is coming in <strong>v2-06</strong>
            </div>
            <div style={urlDisplayStyle}>
              Document URL:
              <br />
              <code style={{ fontSize: 12, opacity: 0.5 }}>
                {documentUrl}
              </code>
            </div>
            <button
              style={{
                background: "#4361ee",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                padding: "10px 20px",
                cursor: "pointer",
                fontSize: 14,
                fontWeight: 600,
                marginTop: 16,
              }}
              onClick={() => {
                // v2-06: Initialize epub.js + EPUBAdapter here
                console.debug(
                  "[Brave Read Aloud] EPUB load requested (v2-06 integration point):",
                  documentUrl
                );
              }}
            >
              Load Document (Coming in v2-06)
            </button>
          </>
        )}

        {state === "error" && (
          <>
            <div style={{ fontSize: 18, color: "#ff6b6b", marginBottom: 8 }}>
              Could not load EPUB
            </div>
            <div style={{ fontSize: 13, opacity: 0.6 }}>
              No document URL was provided. This viewer requires a URL
              parameter (hash fragment or query string).
            </div>
          </>
        )}

        {state === "unsupported" && (
          <>
            <div style={{ fontSize: 18, color: "#ffd43b", marginBottom: 8 }}>
              Unsupported Document Type
            </div>
            <div style={{ fontSize: 13, opacity: 0.6 }}>
              The provided URL does not point to an EPUB document.
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---- Mount ----

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<EpubViewerApp />);
} else {
  console.error("[Brave Read Aloud] EPUB viewer: #root element not found");
}

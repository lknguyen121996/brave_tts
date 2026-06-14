// ============================================================
// Popup Entry — Brave Read Aloud V2
// ============================================================
//
// Mounts the React popup UI. The popup is a standard extension
// action popup (not Shadow DOM — it's already isolated).

import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(React.createElement(App));
}

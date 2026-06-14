pdfjsLib.GlobalWorkerOptions.workerSrc = "pdf.worker.min.js";

const SCALE = 1.5;
const VIEWER = document.getElementById("viewer");
const STATUS = document.getElementById("status-overlay");
let pdfDoc = null, totalPages = 0;

function getPdfUrl() {
  const params = new URLSearchParams(location.search);
  const u = params.get("url");
  if (!u) return null;
  let url = decodeURIComponent(u);
  if (/%[0-9A-Fa-f]{2}/.test(url)) url = decodeURIComponent(url);
  return url;
}

async function renderPage(num) {
  const page = await pdfDoc.getPage(num);
  const vp = page.getViewport({ scale: SCALE });

  const container = document.createElement("div");
  container.className = "page-container";
  container.dataset.braveTtsBlock = "1"; // TTS: findBlockFromTarget fallback
  container.style.width = `${vp.width}px`;
  container.style.height = `${vp.height}px`;

  const canvas = document.createElement("canvas");
  canvas.width = vp.width; canvas.height = vp.height;
  const ctx = canvas.getContext("2d");

  // PDF.js v3 requires --scale-factor CSS variable on textLayer parent
  container.style.setProperty("--scale-factor", String(SCALE));

  const textLayer = document.createElement("div");
  textLayer.className = "textLayer";
  textLayer.style.width = `${vp.width}px`;
  textLayer.style.height = `${vp.height}px`;

  container.appendChild(canvas);
  container.appendChild(textLayer);
  VIEWER.appendChild(container);

  await page.render({ canvasContext: ctx, viewport: vp }).promise;

  const content = await page.getTextContent();
  pdfjsLib.renderTextLayer({
    textContentSource: content,
    container: textLayer,
    viewport: vp,
    textDivs: [],
  });

  // Mark spans for TTS — each span becomes a hover target
  const spans = textLayer.querySelectorAll("span");
  spans.forEach(s => { s.dataset.braveTtsSpan = "1"; s.dataset.braveTtsBlock = "1"; });

  return container;
}

async function renderAll() {
  VIEWER.innerHTML = "";
  for (let i = 1; i <= totalPages; i++) {
    STATUS.textContent = `Rendering… ${Math.round(i/totalPages*100)}%`;
    await renderPage(i);
  }
  STATUS.style.display = "none";
  document.getElementById("page-info").textContent = `${totalPages} pages`;
  document.getElementById("btn-prev").disabled = false;
  document.getElementById("btn-next").disabled = false;
  window.dispatchEvent(new CustomEvent("brave-tts-pdf-ready"));
}

let curPage = 1;
function go(n) {
  const to = Math.max(1, Math.min(n, totalPages));
  if (to === curPage) return;
  curPage = to;
  VIEWER.children[to - 1]?.scrollIntoView({ behavior: "smooth", block: "start" });
}

// Scroll-based page tracking
let _st = null;
VIEWER.addEventListener("scroll", () => {
  if (_st) return;
  _st = setTimeout(() => { _st = null;
    const mid = window.innerHeight / 2;
    for (let i = 0; i < VIEWER.children.length; i++) {
      const r = VIEWER.children[i].getBoundingClientRect();
      if (r.top <= mid && r.bottom >= mid) { curPage = i + 1; break; }
    }
    document.getElementById("page-info").textContent = `Page ${curPage} / ${totalPages}`;
  }, 200);
}, { passive: true });

// Init
(async () => {
  const url = getPdfUrl();
  if (!url) { STATUS.textContent = "No PDF URL."; return; }
  document.getElementById("pdf-title").textContent =
    decodeURIComponent(new URL(url).pathname.split("/").pop() || "PDF");

  STATUS.textContent = "Loading…";
  const task = pdfjsLib.getDocument({ url });
  pdfDoc = await task.promise;
  totalPages = pdfDoc.numPages;
  await renderAll();
})().catch(err => { STATUS.textContent = `Failed: ${err.message}`; console.error(err); });

document.getElementById("btn-prev").addEventListener("click", () => go(curPage - 1));
document.getElementById("btn-next").addEventListener("click", () => go(curPage + 1));
document.addEventListener("keydown", e => {
  if (e.key === "ArrowLeft") go(curPage - 1);
  if (e.key === "ArrowRight") go(curPage + 1);
});

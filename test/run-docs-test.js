const { chromium } = require("playwright");
const path = require("path");

const EXT_PATH = path.resolve(__dirname, "..");
const DOCS_URL =
  "https://docs.google.com/document/d/1rdEQ6b9kb3t-WIG4_lC7dDQdPP-h1r7wLgOCoHquR7E/edit?usp=sharing";
const PROFILE = path.join(__dirname, ".e2e-profile-docs");

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: false,
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      "--no-first-run",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });

  const page = await ctx.newPage();
  console.log("Opening Google Doc...");
  await page.goto(DOCS_URL, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(8000);

  const diag = await page.evaluate(() => {
    let closureText = null;
    let annotateFlag = window._docs_annotate_canvas_by_ext || null;
    let bridge = !!window.__braveTtsDocsPage;
    try {
      const eventId = "diag";
      const handler = (event) => {
        if (event.detail?.eventId === eventId) {
          closureText = event.detail.text || null;
          annotateFlag = event.detail.annotateFlag || annotateFlag;
        }
      };
      window.addEventListener("brave-tts-docs-text", handler);
      window.dispatchEvent(new CustomEvent("brave-tts-docs-extract", { detail: { eventId } }));
      window.removeEventListener("brave-tts-docs-text", handler);
    } catch {
      /* ignore */
    }

    return {
      url: location.href,
      title: document.title,
      bridge,
      a11yRects: document.querySelectorAll(
        ".kix-canvas-tile-content svg>g>rect[aria-label], .kix-canvas-tile-content svg>g[role=paragraph]>rect[aria-label]"
      ).length,
      lineViews: document.querySelectorAll(".kix-lineview-content").length,
      annotateFlag,
      closureTextSample: (closureText || "").slice(0, 240),
      closureTextLen: (closureText || "").length,
      editorText: (document.querySelector(".kix-appview-editor")?.innerText || "").slice(0, 200),
      canvasPages: document.querySelectorAll(".canvas-first-page, .kix-page-paginated").length,
      hint: document.querySelector(".brave-tts-docs-hint")?.textContent?.trim() || "",
    };
  });

  console.log("Diagnostics:", JSON.stringify(diag, null, 2));

  if (diag.closureTextLen < 2 && diag.a11yRects < 2 && !diag.editorText.trim()) {
    console.log("\nFAIL: No readable text sources detected on page.");
    console.log("Page may require Google sign-in or annotated canvas not enabled.");
    await page.screenshot({ path: path.join(__dirname, "docs-test-screenshot.png"), fullPage: false });
    console.log("Screenshot saved to test/docs-test-screenshot.png");
    await ctx.close();
    process.exit(1);
  }

  const editor = page.locator(".kix-appview-editor, .kix-rotatingtilemanager-content, #docs-editor-container").first();
  const box = await editor.boundingBox().catch(() => null);
  if (box) {
    const x = box.x + box.width * 0.45;
    const y = box.y + box.height * 0.35;
    await page.mouse.move(x, y);
    await page.waitForTimeout(700);

    const hoverVisible = await page.locator(".brave-tts-hover-play").isVisible().catch(() => false);
    console.log("Hover play visible:", hoverVisible);

    if (hoverVisible) {
      await page.click(".brave-tts-hover-play");
    } else {
      console.log("Trying double-click...");
      await page.mouse.dblclick(x, y);
    }

    await page.waitForTimeout(3000);
  }

  const after = await page.evaluate(() => ({
    toolbar: !!document.querySelector(".brave-tts-toolbar"),
    status: document.querySelector(".brave-tts-toolbar .status")?.textContent?.trim() || "",
    segments: window.__braveTtsLoaded ? "content-loaded" : "no-content",
    speaking: window.speechSynthesis?.speaking,
    segmentCount: document.querySelector(".brave-tts-toolbar") ? "toolbar-shown" : "none",
  }));

  console.log("After start attempt:", after);

  const status = after.status;
  if (after.toolbar && (status.includes("Đang đọc") || status.includes("Hoàn thành"))) {
    console.log("\nPASS: Extension started reading Google Doc");
    await page.waitForTimeout(4000);
  } else {
    const segInfo = await page.evaluate(() => {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: "PING" }, () => {
          /* ignore */
        });
        resolve({ note: "Check manually in browser window" });
      }).catch?.(() => ({ note: "eval only" }));
    }).catch(() => ({}));

    console.log("\nPARTIAL: Page loaded but TTS may not have started.");
    console.log("Status:", status || "(no toolbar)");
    console.log(segInfo);
    await page.screenshot({ path: path.join(__dirname, "docs-test-screenshot.png"), fullPage: false });
    console.log("Screenshot saved to test/docs-test-screenshot.png");
  }

  await page.waitForTimeout(5000);
  await ctx.close();
})().catch((err) => {
  console.error("FAIL:", err.message || err);
  process.exit(1);
});

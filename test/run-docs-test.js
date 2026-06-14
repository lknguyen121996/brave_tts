const path = require("path");
const { launchWithExtension, pass, fail } = require("./lib/helpers");

const DOCS_URL =
  process.env.BRAVE_TTS_DOCS_URL ||
  "https://docs.google.com/document/d/1rdEQ6b9kb3t-WIG4_lC7dDQdPP-h1r7wLgOCoHquR7E/edit?usp=sharing";
const PROFILE = path.join(__dirname, ".e2e-profile-docs");
const SCREENSHOT = path.join(__dirname, "docs-test-screenshot.png");

async function collectDocsDiagnostics(page) {
  return page.evaluate(() => {
    let closureText = null;
    let annotateFlag = window._docs_annotate_canvas_by_ext || null;
    const eventId = "brave-tts-docs-diag";
    const handler = (event) => {
      if (event.detail?.eventId === eventId) {
        closureText = event.detail.text || null;
        annotateFlag = event.detail.annotateFlag || annotateFlag;
      }
    };
    window.addEventListener("brave-tts-docs-text", handler);
    window.dispatchEvent(new CustomEvent("brave-tts-docs-extract", { detail: { eventId } }));
    window.removeEventListener("brave-tts-docs-text", handler);

    return {
      bridge: !!window.__braveTtsDocsPage,
      a11yRects: document.querySelectorAll(
        ".kix-canvas-tile-content svg>g>rect[aria-label], " +
        ".kix-canvas-tile-content svg>g[role=paragraph]>rect[aria-label]"
      ).length,
      annotateFlag,
      closureTextLen: (closureText || "").length,
      editorText: (document.querySelector(".kix-appview-editor")?.innerText || "").trim().length,
    };
  });
}

(async () => {
  let context;
  try {
    context = await launchWithExtension({
      profile: PROFILE,
      extraArgs: ["--autoplay-policy=no-user-gesture-required"],
    });

    const page = await context.newPage();
    console.log("Opening Google Doc...");
    await page.goto(DOCS_URL, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForTimeout(8000);

    const diag = await collectDocsDiagnostics(page);
    console.log("Diagnostics:", JSON.stringify(diag, null, 2));

    if (diag.closureTextLen < 2 && diag.a11yRects < 2 && diag.editorText < 2) {
      await page.screenshot({ path: SCREENSHOT, fullPage: false });
      fail(`No readable text sources (screenshot: ${SCREENSHOT})`);
    }

    if (!diag.bridge) fail("docs-page bridge not loaded");
    if (!diag.annotateFlag) fail("_docs_annotate_canvas_by_ext not set");

    const editor = page.locator(
      ".kix-appview-editor, .kix-rotatingtilemanager-content, #docs-editor-container"
    ).first();
    const box = await editor.boundingBox();
    if (!box) fail("Docs editor surface not found");

    const x = box.x + box.width * 0.45;
    const y = box.y + box.height * 0.35;
    await page.mouse.move(x, y);
    await page.waitForTimeout(700);

    if (await page.locator(".brave-tts-hover-play").isVisible().catch(() => false)) {
      await page.click(".brave-tts-hover-play");
    } else {
      await page.mouse.dblclick(x, y);
    }

    await page.waitForTimeout(3000);

    const after = await page.evaluate(() => ({
      toolbar: !!document.querySelector(".brave-tts-toolbar"),
      status: document.querySelector(".brave-tts-toolbar .status")?.textContent?.trim() || "",
      speaking: window.speechSynthesis?.speaking,
    }));

    console.log("After start:", after);

    const reading = /Đang đọc|Reading/.test(after.status);
    if (!after.toolbar || !reading) {
      await page.screenshot({ path: SCREENSHOT, fullPage: false });
      fail(`TTS did not start (status: ${after.status || "none"}, screenshot: ${SCREENSHOT})`);
    }

    pass("Google Docs reading started");
  } catch (err) {
    fail(err.message || String(err));
  } finally {
    if (context) await context.close().catch(() => {});
  }
})();

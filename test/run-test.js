const { chromium } = require("playwright");
const path = require("path");
const http = require("http");
const fs = require("fs");

const EXT_PATH = path.resolve(__dirname, "..");
const TEST_PAGE = path.join(__dirname, "page.html");
const PORT = 8765;
const PROFILE = path.join(__dirname, ".e2e-profile");

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(fs.readFileSync(TEST_PAGE));
    });
    server.on("error", reject);
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

async function getExtensionWorker(context, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const sw = context
      .serviceWorkers()
      .find((s) => s.url().startsWith("chrome-extension://") && s.url().includes("background"));
    if (sw) return sw;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("Extension service worker not found");
}

(async () => {
  let server;
  let context;

  try {
    server = await startServer();
    const url = `http://127.0.0.1:${PORT}/`;

    context = await chromium.launchPersistentContext(PROFILE, {
      headless: false,
      ignoreDefaultArgs: ["--disable-extensions"],
      args: [
        `--disable-extensions-except=${EXT_PATH}`,
        `--load-extension=${EXT_PATH}`,
        "--no-first-run",
        "--disable-default-apps",
        "--autoplay-policy=no-user-gesture-required",
      ],
    });

    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);

    const sw = await getExtensionWorker(context);
    const extId = sw.url().split("/")[2];
    console.log("Extension ID:", extId);

    await page.click("article p");
    await page.evaluate(() => {
      window.speechSynthesis.getVoices();
      const prime = new SpeechSynthesisUtterance(" ");
      prime.volume = 0;
      window.speechSynthesis.speak(prime);
      window.speechSynthesis.cancel();
    });

    const startResult = await sw.evaluate(
      async ({ pageUrl, settings }) => {
        const tabs = await chrome.tabs.query({ url: `${pageUrl}*` });
        if (!tabs.length) return { ok: false, reason: "content tab not found" };
        try {
          const resp = await chrome.tabs.sendMessage(tabs[0].id, {
            type: "START_READING",
            settings,
          });
          return { ok: true, resp, tabId: tabs[0].id };
        } catch (e) {
          return { ok: false, reason: String(e) };
        }
      },
      {
        pageUrl: url,
        settings: { provider: "webspeech", rate: 1.1, lang: "vi-VN", voice: "" },
      }
    );

    console.log("Start result:", startResult);
    if (!startResult.ok) throw new Error(startResult.reason || "failed to start");

    await page.waitForSelector(".brave-tts-gesture-prompt", { timeout: 8000 });
    await page.click(".brave-tts-gesture-start");
    await page.waitForSelector(".brave-tts-toolbar", { timeout: 8000 });
    await page.waitForTimeout(2500);

    const toolbarVisible = await page.locator(".brave-tts-toolbar").isVisible();
    const highlightCount = await page.locator(".brave-tts-highlight").count();
    const cssHighlightActive = await page.evaluate(() => {
      try {
        return (CSS.highlights?.get("brave-tts-sentence")?.size || 0) > 0;
      } catch {
        return false;
      }
    });
    const statusText = ((await page.locator(".brave-tts-toolbar .status").textContent()) || "").trim();
    const hasError = statusText.startsWith("Lỗi:");

    console.log("Toolbar visible:", toolbarVisible);
    console.log("Highlight count:", highlightCount, "cssHighlight:", cssHighlightActive);
    console.log("Status:", statusText);

    await page.screenshot({ path: path.join(__dirname, "screenshot.png") });

    const reading =
      !hasError &&
      (statusText.includes("Đang đọc") ||
        statusText.includes("Hoàn thành") ||
        statusText.includes("tạm dừng"));

    if (toolbarVisible && (highlightCount > 0 || cssHighlightActive) && reading) {
      console.log("PASS: Extension read aloud works with highlight + toolbar");
    } else {
      throw new Error(`UI checks failed (error=${hasError})`);
    }
  } finally {
    if (context) await context.close().catch(() => {});
    if (server) server.close();
  }
})().catch((err) => {
  console.error("FAIL:", err.message || err);
  process.exit(1);
});

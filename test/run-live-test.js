const { chromium } = require("playwright");
const path = require("path");
const http = require("http");
const fs = require("fs");

const EXT_PATH = path.resolve(__dirname, "..");
const TEST_PAGE = path.join(__dirname, "page.html");
const PORT = 8765;
const PROFILE = path.join(__dirname, ".e2e-profile-live");

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

async function startReadingOnPage(page, sw, pageUrl) {
  await page.click("body");
  await page.evaluate(() => {
    window.speechSynthesis.getVoices();
    const prime = new SpeechSynthesisUtterance(" ");
    prime.volume = 0;
    window.speechSynthesis.speak(prime);
    window.speechSynthesis.cancel();
  });

  const startResult = await sw.evaluate(
    async ({ pageUrl, settings }) => {
      const tabs = await chrome.tabs.query({ url: pageUrl });
      const tab = tabs[0] || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
      if (!tab) return { ok: false, reason: "content tab not found" };
      try {
        const resp = await chrome.tabs.sendMessage(tab.id, {
          type: "START_READING",
          settings,
        });
        return { ok: true, resp, tabId: tab.id, tabUrl: tab.url };
      } catch (e) {
        return { ok: false, reason: String(e) };
      }
    },
    {
      pageUrl,
      settings: { provider: "webspeech", rate: 1.1, lang: "vi-VN", voice: "" },
    }
  );

  return startResult;
}

async function assertReading(page, label) {
  await page.waitForSelector(".brave-tts-gesture-prompt", { timeout: 10000 });
  await page.click(".brave-tts-gesture-start");
  await page.waitForSelector(".brave-tts-toolbar", { timeout: 10000 });
  await page.waitForTimeout(2000);

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

  console.log(`[${label}] toolbar=${toolbarVisible} highlight=${highlightCount} cssHighlight=${cssHighlightActive} status=${statusText}`);

  const reading =
    !hasError &&
    (statusText.includes("Đang đọc") ||
      statusText.includes("Hoàn thành") ||
      statusText.includes("tạm dừng"));

  if (!toolbarVisible || (!highlightCount && !cssHighlightActive) || !reading) {
    throw new Error(`${label}: read aloud UI checks failed`);
  }
}

(async () => {
  let server;
  let context;

  try {
    server = await startServer();
    const localUrl = `http://127.0.0.1:${PORT}/`;

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

    const sw = await getExtensionWorker(context);
    console.log("Extension ID:", sw.url().split("/")[2]);

    const page = await context.newPage();
    await page.goto(localUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);

    const localStart = await startReadingOnPage(page, sw, `${localUrl}*`);
    console.log("Local start:", localStart);
    if (!localStart.ok) throw new Error(localStart.reason);
    await assertReading(page, "local");
    await page.evaluate(() => {
      document.dispatchEvent(new CustomEvent("brave-tts-stop"));
    }).catch(() => {});
    await sw.evaluate(async () => {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { type: "STOP_READING" });
    });

    await page.waitForTimeout(800);

    const liveUrl = "https://vi.wikipedia.org/wiki/V%C3%B9ng_Tr%E1%BB%9Di";
    await page.goto(liveUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(2000);

    const liveStart = await startReadingOnPage(page, sw, `${liveUrl}*`);
    console.log("Live start:", liveStart);
    if (!liveStart.ok) throw new Error(liveStart.reason);
    await assertReading(page, "wikipedia");
    await page.screenshot({ path: path.join(__dirname, "screenshot-wikipedia.png") });

    console.log("PASS: Extension works on local page and Wikipedia");
  } finally {
    if (context) await context.close().catch(() => {});
    if (server) server.close();
  }
})().catch((err) => {
  console.error("FAIL:", err.message || err);
  process.exit(1);
});

const { chromium } = require("playwright");
const path = require("path");
const http = require("http");
const fs = require("fs");

const EXT_PATH = path.resolve(__dirname, "..");
const TEST_PAGE = path.join(__dirname, "page.html");
const PORT = 8765;
const PROFILE = path.join(__dirname, ".brave-popup-profile");
const BRAVE = "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";

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
      executablePath: BRAVE,
      ignoreDefaultArgs: ["--disable-extensions"],
      args: [
        `--disable-extensions-except=${EXT_PATH}`,
        `--load-extension=${EXT_PATH}`,
        "--no-first-run",
      ],
    });

    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);

    const sw = await getExtensionWorker(context);
    const pageUrl = page.url();
    const startResult = await sw.evaluate(
      async ({ pageUrl, settings }) => {
        const tabs = await chrome.tabs.query({ url: pageUrl });
        const tab = tabs.at(-1);
        if (!tab?.id) return { ok: false, reason: "content tab not found" };
        try {
          await chrome.tabs.sendMessage(tab.id, {
            type: "START_READING",
            settings,
          });
          return { ok: true, tabId: tab.id };
        } catch (e) {
          return { ok: false, reason: String(e) };
        }
      },
      {
        pageUrl,
        settings: { provider: "webspeech", rate: 1, lang: "vi-VN", voice: "" },
      }
    );

    if (!startResult.ok) throw new Error(startResult.reason || "failed to start");

    await page.waitForSelector(".brave-tts-gesture-prompt", { timeout: 10000 });
    await page.click(".brave-tts-gesture-start");
    await page.waitForSelector(".brave-tts-toolbar", { timeout: 10000 });
    await page.waitForTimeout(2500);

    const status = ((await page.locator(".brave-tts-toolbar .status").textContent()) || "").trim();
    console.log("Popup flow status:", status);

    const speech = await page.evaluate(() => ({
      speaking: window.speechSynthesis?.speaking,
      pending: window.speechSynthesis?.pending,
    }));
    console.log("Speech state:", speech);

    if (status.startsWith("Lỗi:")) throw new Error(status);
    if (!status.includes("Đang đọc") && !status.includes("Hoàn thành")) {
      throw new Error(`Unexpected status: ${status}`);
    }
    console.log("PASS: Popup start flow works in Brave");
  } finally {
    if (context) await context.close().catch(() => {});
    if (server) server.close();
  }
})().catch((err) => {
  console.error("FAIL:", err.message || err);
  process.exit(1);
});

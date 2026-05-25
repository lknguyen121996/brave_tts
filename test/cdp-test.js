const { chromium } = require("playwright");
const path = require("path");
const http = require("http");
const fs = require("fs");

const TEST_PAGE = path.join(__dirname, "page.html");
const PORT = 8765;

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(fs.readFileSync(TEST_PAGE));
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

(async () => {
  const server = await startServer();
  await new Promise((r) => setTimeout(r, 2000));

  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
  const context = browser.contexts()[0];
  const pages = context.pages();

  console.log("Pages:", pages.map((p) => p.url()));

  let page = pages.find((p) => p.url().includes("127.0.0.1"));
  if (!page) {
    page = await context.newPage();
    await page.goto(`http://127.0.0.1:${PORT}/`);
  }

  await page.waitForTimeout(2000);

  const extId = await page.evaluate(async () => {
    const exts = await chrome.management.getAll();
    const mine = exts.find((e) => e.name === "Brave Read Aloud");
    return mine?.id || null;
  }).catch(() => null);

  console.log("Extension ID from page:", extId);

  if (!extId) {
    const extPage = pages.find((p) => p.url().includes("chrome://extensions"));
    if (extPage) {
      const text = await extPage.textContent("body").catch(() => "");
      console.log("Extensions page snippet:", text?.slice(0, 500));
    }
    console.error("FAIL: extension not installed");
    process.exit(1);
  }

  await page.evaluate(
    ({ extId, settings }) =>
      chrome.runtime.sendMessage(extId, { ping: true }).catch?.(() => {}),
    { extId, settings: {} }
  );

  const started = await page.evaluate(
    ({ settings }) =>
      new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: "START_READING", settings }, () => {
          resolve({ lastError: chrome.runtime.lastError?.message || null });
        });
      }),
    {
      settings: { provider: "webspeech", rate: 1.1, lang: "vi-VN", voice: "" },
    }
  ).catch((e) => ({ error: String(e) }));

  console.log("Direct message result:", started);

  await browser.close();
  server.close();
})();

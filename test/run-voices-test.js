const { chromium } = require("playwright");
const path = require("path");
const http = require("http");
const fs = require("fs");

const EXT_PATH = path.resolve(__dirname, "..");
const TEST_PAGE = path.join(__dirname, "page.html");
const BRAVE = "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
const PROFILE = path.join(__dirname, ".brave-voices-profile");

async function getExtensionWorker(context) {
  for (let i = 0; i < 20; i++) {
    const sw = context
      .serviceWorkers()
      .find((s) => s.url().includes("background"));
    if (sw) return sw;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("Extension worker not found");
}

(async () => {
  const server = http.createServer((_, res) => res.end(fs.readFileSync(TEST_PAGE)));
  await new Promise((r) => server.listen(8765, "127.0.0.1", r));
  const url = "http://127.0.0.1:8765/";

  const ctx = await chromium.launchPersistentContext(PROFILE, {
    executablePath: BRAVE,
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`, "--no-first-run"],
    headless: false,
  });

  const page = await ctx.newPage();
  await page.goto(url);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(800);

  const sw = await getExtensionWorker(ctx);
  const result = await sw.evaluate(
    async ({ pageUrl }) => {
      const tabs = await chrome.tabs.query({ url: pageUrl });
      const tab = tabs.at(-1);
      if (!tab?.id) return { ok: false, count: 0 };
      const resp = await chrome.tabs.sendMessage(tab.id, { type: "GET_VOICES" });
      return { ok: true, count: (resp?.voices || []).length };
    },
    { pageUrl: url }
  );

  console.log("Voices from content script:", result);
  if (!result.ok || result.count < 1) {
    throw new Error("Expected Web Speech voices from GET_VOICES");
  }

  console.log("PASS: voice list loads via content script");
  await ctx.close();
  server.close();
})().catch((e) => {
  console.error("FAIL:", e.message || e);
  process.exit(1);
});

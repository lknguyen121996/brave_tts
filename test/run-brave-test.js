const { chromium } = require("playwright");
const path = require("path");
const http = require("http");
const fs = require("fs");

const EXT_PATH = path.resolve(__dirname, "..");
const TEST_PAGE = path.join(__dirname, "page.html");
const PORT = 8765;
const PROFILE = path.join(__dirname, ".brave-test-profile");

(async () => {
  const server = http.createServer((_, res) => res.end(fs.readFileSync(TEST_PAGE)));
  await new Promise((r) => server.listen(8765, "127.0.0.1", r));
  const url = "http://127.0.0.1:8765/";

  const ctx = await chromium.launchPersistentContext(PROFILE, {
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`, "--no-first-run", "--autoplay-policy=no-user-gesture-required"],
    headless: false,
  });

  const page = await ctx.newPage();
  await page.goto(url);
  await page.waitForTimeout(1000);

  const p = page.locator("article p").first();
  const box = await p.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(2100);
  await page.click(".brave-tts-hover-play");
  await page.waitForSelector(".brave-tts-toolbar", { timeout: 10000 });
  await page.waitForTimeout(1500);

  const status = ((await page.locator(".brave-tts-toolbar .status").textContent()) || "").trim();
  if (status.startsWith("Lỗi:")) throw new Error(status);
  console.log("PASS: basic hover read works");
  await ctx.close();
  server.close();
})().catch((e) => {
  console.error("FAIL:", e.message || e);
  process.exit(1);
});

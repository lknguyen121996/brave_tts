const { chromium } = require("playwright");
const path = require("path");
const http = require("http");
const fs = require("fs");

const EXT_PATH = path.resolve(__dirname, "..");
const TEST_PAGE = path.join(__dirname, "page.html");
const PORT = 8765;
const PROFILE = path.join(__dirname, ".uber-test-profile");

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`, "--no-first-run", "--autoplay-policy=no-user-gesture-required"],
    headless: false,
  });

  const page = await ctx.newPage();
  await page.goto("https://www.uber.com/us/en/blog/solving-the-agent-identity-crisis/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForTimeout(5000);

  const stats = await page.evaluate(() => ({
    paraButtons: document.querySelectorAll(".brave-tts-para-play").length,
    content: !!document.querySelector("[data-testid='content']"),
  }));
  if (stats.paraButtons !== 0) throw new Error("Paragraph buttons should not be present");
  if (!stats.content) throw new Error("Article content block not found");

  const paragraph = page.locator("[data-testid='content'] p").first();
  const box = await paragraph.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(2500);
  await page.waitForSelector(".brave-tts-hover-play", { timeout: 5000 });
  await page.click(".brave-tts-hover-play");
  await page.waitForSelector(".brave-tts-toolbar", { timeout: 10000 });
  await page.waitForTimeout(1500);

  const status = ((await page.locator(".brave-tts-toolbar .status").textContent()) || "").trim();
  if (status.startsWith("Lỗi:")) throw new Error(status);
  console.log("PASS: Uber blog hover play works");
  await ctx.close();
})().catch((err) => {
  console.error("FAIL:", err.message || err);
  process.exit(1);
});

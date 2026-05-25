const { chromium } = require("playwright");
const path = require("path");
const http = require("http");
const fs = require("fs");

const EXT_PATH = path.resolve(__dirname, "..");
const TEST_PAGE = path.join(__dirname, "page.html");
const PORT = 8765;
const PROFILE = path.join(__dirname, ".e2e-profile-ui");

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
        "--autoplay-policy=no-user-gesture-required",
      ],
    });

    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);

    const paraBtnCount = await page.locator(".brave-tts-para-play").count();
    if (paraBtnCount !== 0) throw new Error("Persistent paragraph buttons should be removed");

    const paragraph = page.locator("article p").nth(2);
    const box = await paragraph.boundingBox();
    if (!box) throw new Error("Paragraph box not found");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(2500);
    await page.waitForSelector(".brave-tts-hover-play", { timeout: 5000 });
    await page.click(".brave-tts-hover-play");
    await page.waitForSelector(".brave-tts-toolbar", { timeout: 8000 });
    await page.waitForTimeout(1500);

    const status = ((await page.locator(".brave-tts-toolbar .status").textContent()) || "").trim();
    console.log("Status after hover play:", status);
    if (!status.includes("Đang đọc") && !status.includes("Hoàn thành")) {
      throw new Error(`Unexpected status: ${status}`);
    }

    console.log("PASS: hover play button works");

    async function hoverPlayParagraph(index) {
      const loc = page.locator("article p").nth(index);
      const b = await loc.boundingBox();
      if (!b) throw new Error(`Paragraph ${index} box not found`);
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.waitForTimeout(2500);
      await page.waitForSelector(".brave-tts-hover-play", { timeout: 5000 });
      await page.click(".brave-tts-hover-play");
      await page.waitForTimeout(300);
    }

    await hoverPlayParagraph(1);
    await hoverPlayParagraph(4);
    await hoverPlayParagraph(3);
    await page.waitForTimeout(2000);

    const statusFinal = ((await page.locator(".brave-tts-toolbar .status").textContent()) || "").trim();
    if (!statusFinal.includes("Đang đọc")) throw new Error("Expected single stream still reading");

    console.log("PASS: hover play jump works");

    const p1 = page.locator("article p").nth(1);
    const box1 = await p1.boundingBox();
    await page.mouse.move(box1.x + box1.width / 2, box1.y + box1.height / 2);
    await page.waitForTimeout(2500);
    await page.waitForSelector(".brave-tts-hover-play", { timeout: 5000 });
    await page.click(".brave-tts-hover-play");
    await page.waitForSelector(".brave-tts-toolbar", { timeout: 8000 });
    await page.waitForTimeout(800);
    await page.mouse.wheel(0, 900);
    await page.waitForTimeout(400);

    const backVisible = await page.locator(".brave-tts-back-on-track.is-visible").isVisible();
    if (!backVisible) throw new Error("Back on track should appear after user scroll");

    await page.locator(".brave-tts-back-on-track").click();
    await page.waitForTimeout(600);

    console.log("PASS: back on track scroll recovery works");
  } finally {
    if (context) await context.close().catch(() => {});
    if (server) server.close();
  }
})().catch((err) => {
  console.error("FAIL:", err.message || err);
  process.exit(1);
});

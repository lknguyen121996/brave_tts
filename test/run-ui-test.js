const path = require("path");
const http = require("http");
const fs = require("fs");
const { launchWithExtension, pass, fail } = require("./lib/helpers");

const TEST_PAGE = path.join(__dirname, "page.html");
const PORT = 8765;
const PROFILE = path.join(__dirname, ".e2e-profile-ui");

function resetProfile(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

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
    resetProfile(PROFILE);
    server = await startServer();
    context = await launchWithExtension({
      profile: PROFILE,
      extraArgs: ["--autoplay-policy=no-user-gesture-required"],
    });

    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);

    const paragraph = page.locator("article p").nth(2);
    const box = await paragraph.boundingBox();
    if (!box) fail("Paragraph box not found");

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(1400);
    await page.waitForSelector(".brave-tts-hover-play", { timeout: 10000 });
    await page.click(".brave-tts-hover-play");
    await page.waitForSelector(".brave-tts-toolbar", { timeout: 8000 });
    await page.waitForTimeout(1500);

    const status = ((await page.locator(".brave-tts-toolbar .status").textContent()) || "").trim();
    if (!/Đang đọc|Reading/.test(status) && !/Hoàn thành|Complete/.test(status)) {
      fail(`Unexpected status after hover play: ${status}`);
    }
    pass("hover play button works");

    async function hoverPlayParagraph(index) {
      if (await page.locator(".brave-tts-toolbar").isVisible().catch(() => false)) {
        const stopBtn = page.locator('.brave-tts-toolbar button[data-action="stop"]');
        if (await stopBtn.isVisible().catch(() => false)) {
          await stopBtn.click();
          await page.waitForTimeout(600);
        }
      }

      const loc = page.locator("article p").nth(index);
      const b = await loc.boundingBox();
      if (!b) fail(`Paragraph ${index} box not found`);
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.waitForTimeout(1400);
      await page.waitForSelector(".brave-tts-hover-play", { timeout: 10000 });
      await page.click(".brave-tts-hover-play");
      await page.waitForTimeout(300);
    }

    await hoverPlayParagraph(1);
    await hoverPlayParagraph(4);
    await hoverPlayParagraph(3);
    await page.waitForTimeout(2000);

    const statusFinal = ((await page.locator(".brave-tts-toolbar .status").textContent()) || "").trim();
    if (!/Đang đọc|Reading/.test(statusFinal)) fail("Expected single stream still reading");
    pass("hover play jump works");

    await page.locator('.brave-tts-toolbar button[data-action="stop"]').click();
    await page.waitForTimeout(800);

    const p1 = page.locator("article p").nth(1);
    const box1 = await p1.boundingBox();
    await page.mouse.move(box1.x + box1.width / 2, box1.y + box1.height / 2);
    await page.waitForTimeout(1400);
    await page.waitForSelector(".brave-tts-hover-play", { timeout: 10000 });
    await page.click(".brave-tts-hover-play");
    await page.waitForSelector(".brave-tts-toolbar", { timeout: 8000 });
    await page.waitForTimeout(800);
    await page.mouse.wheel(0, 900);
    await page.waitForTimeout(400);

    if (!(await page.locator(".brave-tts-back-on-track.is-visible").isVisible())) {
      fail("Back on track should appear after user scroll");
    }

    await page.locator(".brave-tts-back-on-track").click();
    await page.waitForTimeout(600);
    pass("back on track scroll recovery works");
  } catch (err) {
    fail(err.message || String(err));
  } finally {
    if (context) await context.close().catch(() => {});
    if (server) server.close();
  }
})();

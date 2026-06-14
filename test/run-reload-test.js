const path = require("path");
const http = require("http");
const fs = require("fs");
const { chromium } = require("playwright");
const { pass, fail, EXT_PATH } = require("./lib/helpers");

const TEST_PAGE = path.join(__dirname, "page.html");
const PORT = 8766;
const PROFILE = path.join(__dirname, ".e2e-profile-reload");

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
    fs.rmSync(PROFILE, { recursive: true, force: true });
    server = await startServer();

    // ───────────────────────────────────────
    // Launch extension and start reading
    // ───────────────────────────────────────
    context = await chromium.launchPersistentContext(PROFILE, {
      headless: false,
      ignoreDefaultArgs: ["--disable-extensions"],
      args: [
        `--disable-extensions-except=${EXT_PATH}`,
        `--load-extension=${EXT_PATH}`,
        "--autoplay-policy=no-user-gesture-required",
        "--no-first-run",
      ],
    });

    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);

    // Hover paragraph 3 and start reading
    const p3 = page.locator("article p").nth(2);
    const box = await p3.boundingBox();
    if (!box) fail("Paragraph box not found");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(900);
    await page.waitForSelector(".brave-tts-hover-play", { timeout: 10000 });
    await page.click(".brave-tts-hover-play");
    await page.waitForSelector(".brave-tts-toolbar", { timeout: 8000 });
    await page.waitForTimeout(500);
    pass("reading started before reload");

    // ───────────────────────────────────────
    // Reload extension (simulate update)
    // ───────────────────────────────────────
    await context.close();
    // Wait for extension to fully shut down before re-launching
    await new Promise((r) => setTimeout(r, 2000));

    context = await chromium.launchPersistentContext(PROFILE, {
      headless: false,
      ignoreDefaultArgs: ["--disable-extensions"],
      args: [
        `--disable-extensions-except=${EXT_PATH}`,
        `--load-extension=${EXT_PATH}`,
        "--autoplay-policy=no-user-gesture-required",
        "--no-first-run",
      ],
    });

    // Navigate to same page — content script reloads fresh
    // Open a dummy page first to trigger service worker startup
    const warmup = await context.newPage();
    await warmup.goto("about:blank");
    await warmup.waitForTimeout(2000);
    await warmup.close();

    const page2 = await context.newPage();
    await page2.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
    // Reload page to ensure content script injection after service worker is ready
    await page2.reload({ waitUntil: "networkidle" });
    await page2.waitForTimeout(2000);

    // ───────────────────────────────────────
    // Verify page still works after reload
    // ───────────────────────────────────────
    const p2 = page2.locator("article p").nth(1);
    const box2 = await p2.boundingBox();
    if (!box2) fail("Paragraph box not found after reload");

    await page2.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2);
    await page2.waitForTimeout(900);
    await page2.waitForSelector(".brave-tts-hover-play", { timeout: 10000 });
    await page2.click(".brave-tts-hover-play");
    await page2.waitForSelector(".brave-tts-toolbar", { timeout: 8000 });
    await page2.waitForTimeout(800);

    const status = ((await page2.locator(".brave-tts-toolbar .status").textContent()) || "").trim();
    if (!/Reading|Đang đọc/.test(status)) {
      fail(`Status after reload: ${status}`);
    }
    pass("reading works after extension reload");

    // ───────────────────────────────────────
    // Stop and hover again (no leak)
    // ───────────────────────────────────────
    const stopBtn = page2.locator('.brave-tts-toolbar button[data-action="stop"]');
    if (await stopBtn.isVisible().catch(() => false)) {
      await stopBtn.click();
      await page2.waitForTimeout(800);
    } else {
      // May have auto-finished — wait and proceed
      await page2.waitForTimeout(800);
    }

    // Move to a different paragraph and verify hover still works
    const p4 = page2.locator("article p").nth(3);
    const box4 = await p4.boundingBox();
    if (!box4) fail("Paragraph 4 box not found");

    // Move mouse away first to clear any residual hover state
    await page2.mouse.move(10, 10);
    await page2.waitForTimeout(300);
    await page2.mouse.move(box4.x + box4.width / 2, box4.y + box4.height / 2);
    await page2.waitForTimeout(1200);
    await page2.waitForSelector(".brave-tts-hover-play", { timeout: 10000 });
    await page2.click(".brave-tts-hover-play");
    await page2.waitForSelector(".brave-tts-toolbar", { timeout: 8000 });
    pass("hover still works after stop+re-hover (no listener leak)");

    console.log("\n✅ All reload recovery tests passed\n");
  } catch (err) {
    fail(err.message || String(err));
  } finally {
    if (context) await context.close().catch(() => {});
    if (server) server.close();
  }
})();

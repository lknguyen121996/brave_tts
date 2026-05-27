const { chromium } = require("playwright");
const path = require("path");

const EXT_PATH = path.resolve(__dirname, "../..");

async function launchWithExtension({ profile, headless = false, extraArgs = [] } = {}) {
  if (!profile) throw new Error("profile path is required");

  return chromium.launchPersistentContext(profile, {
    headless,
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      "--no-first-run",
      ...extraArgs,
    ],
  });
}

async function getExtensionId(context) {
  let worker = context.serviceWorkers()[0];
  if (!worker) {
    const page = await context.newPage();
    await page.goto("about:blank");
    await page.waitForTimeout(1500);
    worker = context.serviceWorkers()[0];
    await page.close().catch(() => {});
  }
  if (!worker) {
    worker = await context.waitForEvent("serviceworker", { timeout: 15000 });
  }
  const match = worker.url().match(/chrome-extension:\/\/([^/]+)/);
  if (!match) throw new Error("Extension service worker not found");
  return match[1];
}

function pass(message) {
  console.log(`PASS: ${message}`);
}

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

module.exports = {
  EXT_PATH,
  launchWithExtension,
  getExtensionId,
  pass,
  fail,
};

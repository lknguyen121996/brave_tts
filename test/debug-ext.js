const { chromium } = require("playwright");
const path = require("path");

const EXT_PATH = path.resolve(__dirname, "..");
const userDataDir = path.join(__dirname, ".chrome-profile-debug");

(async () => {
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    channel: "chrome",
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      "--no-first-run",
    ],
  });

  await context.newPage();
  await new Promise((r) => setTimeout(r, 5000));

  console.log("Service workers:", context.serviceWorkers().map((s) => s.url()));
  console.log("Background pages:", context.backgroundPages().map((p) => p.url()));
  console.log("Pages:", context.pages().map((p) => p.url()));

  await context.close();
})();

const { chromium } = require("playwright");
const path = require("path");

const EXT_PATH = path.resolve(__dirname, "..");
const PROFILE = path.join(__dirname, ".e2e-profile-edge");

(async () => {
  let context;
  try {
    context = await chromium.launchPersistentContext(PROFILE, {
      headless: false,
      ignoreDefaultArgs: ["--disable-extensions"],
      args: [
        `--disable-extensions-except=${EXT_PATH}`,
        `--load-extension=${EXT_PATH}`,
        "--no-first-run",
      ],
    });

    const worker = context.serviceWorkers()[0] || (await context.waitForEvent("serviceworker"));
    const extId = worker.url().match(/chrome-extension:\/\/([^/]+)/)[1];
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extId}/background/edge-synth.html`);

    const byteLength = await page.evaluate(async () => {
      return new Promise((resolve, reject) => {
        const id = "test-1";
        const timer = setTimeout(() => reject(new Error("synthesis timeout")), 60000);
        window.addEventListener("message", (event) => {
          if (event.data?.type !== "EDGE_SYNTHESIZE_RESULT" || event.data.id !== id) return;
          clearTimeout(timer);
          if (!event.data.ok) {
            reject(new Error(event.data.error || "synthesis failed"));
            return;
          }
          const len = event.data.audioBuffer?.byteLength || 0;
          if (!len) reject(new Error("empty audio"));
          else resolve(len);
        });
        window.postMessage(
          {
            type: "EDGE_SYNTHESIZE",
            id,
            text: "Xin chao Edge TTS.",
            voice: "vi-VN-HoaiMyNeural",
            lang: "vi-VN",
            rate: 1,
          },
          "*"
        );
      });
    });

    console.log("Synthesis audio bytes:", byteLength);
    console.log("PASS: Edge TTS iframe synthesis works");
  } catch (err) {
    console.error("FAIL:", err.message);
    process.exitCode = 1;
  } finally {
    await context?.close();
  }
})();

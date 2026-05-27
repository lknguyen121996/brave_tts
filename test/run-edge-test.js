const path = require("path");
const { launchWithExtension, getExtensionId, pass, fail } = require("./lib/helpers");

const PROFILE = path.join(__dirname, ".e2e-profile-edge");

(async () => {
  let context;
  try {
    context = await launchWithExtension({ profile: PROFILE });
    const extId = await getExtensionId(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extId}/background/edge-synth.html`);

    const nonStreaming = await page.evaluate(async () => {
      return new Promise((resolve, reject) => {
        const id = "test-non-stream";
        const timer = setTimeout(() => reject(new Error("synthesis timeout")), 60000);
        window.addEventListener("message", (event) => {
          if (event.data?.type !== "EDGE_SYNTHESIZE_RESULT" || event.data.id !== id) return;
          clearTimeout(timer);
          if (!event.data.ok) reject(new Error(event.data.error || "synthesis failed"));
          else resolve(event.data.audioBuffer?.byteLength || 0);
        });
        window.postMessage(
          {
            type: "EDGE_SYNTHESIZE",
            id,
            text: "Xin chao Edge TTS.",
            voice: "vi-VN-HoaiMyNeural",
            lang: "vi-VN",
            rate: 1,
            streaming: false,
          },
          "*"
        );
      });
    });

    if (!nonStreaming) fail("Non-streaming synthesis returned empty audio");
    console.log("Non-streaming audio bytes:", nonStreaming);

    const streaming = await page.evaluate(async () => {
      return new Promise((resolve, reject) => {
        const id = "test-stream";
        let chunkCount = 0;
        const timer = setTimeout(() => reject(new Error("streaming synthesis timeout")), 60000);

        window.addEventListener("message", (event) => {
          if (event.data?.id !== id) return;
          if (event.data?.type === "EDGE_SYNTHESIZE_CHUNK") {
            chunkCount += 1;
            return;
          }
          if (event.data?.type !== "EDGE_SYNTHESIZE_RESULT") return;
          clearTimeout(timer);
          if (!event.data.ok) reject(new Error(event.data.error || "streaming synthesis failed"));
          else resolve({
            byteLength: event.data.audioBuffer?.byteLength || 0,
            chunkCount,
          });
        });

        window.postMessage(
          {
            type: "EDGE_SYNTHESIZE",
            id,
            text: "Xin chao Edge TTS streaming.",
            voice: "vi-VN-HoaiMyNeural",
            lang: "vi-VN",
            rate: 1,
            streaming: true,
          },
          "*"
        );
      });
    });

    if (!streaming.byteLength) fail("Streaming synthesis returned empty audio");
    if (!streaming.chunkCount) fail("Expected at least one EDGE_SYNTHESIZE_CHUNK before done");

    console.log("Streaming audio bytes:", streaming.byteLength);
    console.log("Streaming chunk count:", streaming.chunkCount);
    pass("Edge TTS iframe synthesis (non-streaming + streaming)");
  } catch (err) {
    fail(err.message || String(err));
  } finally {
    if (context) await context.close().catch(() => {});
  }
})();

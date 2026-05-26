const edgeDnrReady = ensureEdgeTtsWsHeaders().catch(() => {});
const edgeSessionPool = [
  EdgeTtsClient.createSession(),
  EdgeTtsClient.createSession(),
];

function pickEdgeSession() {
  return edgeSessionPool.reduce((best, session) =>
    session.pendingCount < best.pendingCount ? session : best
  );
}

window.addEventListener("message", async (event) => {
  const data = event.data;
  if (!data || data.type !== "EDGE_SYNTHESIZE") return;

  const reply = (payload) => {
    event.source?.postMessage(
      { type: "EDGE_SYNTHESIZE_RESULT", id: data.id, ...payload },
      event.origin
    );
  };

  try {
    await edgeDnrReady;
    const audioBuffer = await EdgeTtsClient.synthesizeWithSession(pickEdgeSession(), {
      text: data.text,
      voice: data.voice,
      lang: data.lang,
      rate: data.rate,
    });
    reply({ ok: true, audioBuffer: audioBuffer.slice(0) });
  } catch (err) {
    reply({ ok: false, error: err?.message || "Edge TTS failed" });
  }
});

window.parent.postMessage({ type: "EDGE_SYNTH_READY" }, "*");

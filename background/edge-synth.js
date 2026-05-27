const edgeDnrReady = ensureEdgeTtsWsHeaders().catch(() => {});
const edgeSessionPool = [
  EdgeTtsClient.createSession(),
  EdgeTtsClient.createSession(),
  EdgeTtsClient.createSession(),
  EdgeTtsClient.createSession(),
];

function pickEdgeSession() {
  return edgeSessionPool.reduce((best, session) =>
    session.pendingCount < best.pendingCount ? session : best
  );
}

edgeDnrReady.then(() => Promise.all(edgeSessionPool.map((session) => session.warmup())));

window.addEventListener("message", async (event) => {
  const data = event.data;
  if (!data || data.type !== "EDGE_SYNTHESIZE") return;

  const reply = (payload, transfer = []) => {
    event.source?.postMessage(
      { type: "EDGE_SYNTHESIZE_RESULT", id: data.id, ...payload },
      event.origin,
      transfer
    );
  };

  const replyChunk = (chunkBuffer) => {
    event.source?.postMessage(
      { type: "EDGE_SYNTHESIZE_CHUNK", id: data.id, chunk: chunkBuffer },
      event.origin,
      [chunkBuffer]
    );
  };

  try {
    await edgeDnrReady;
    const onChunk = data.streaming
      ? (chunkBuffer) => replyChunk(chunkBuffer)
      : null;
    const audioBuffer = await EdgeTtsClient.synthesizeWithSession(pickEdgeSession(), {
      text: data.text,
      voice: data.voice,
      lang: data.lang,
      rate: data.rate,
      priority: Boolean(data.priority),
      onChunk,
    });
    reply({ ok: true, done: true, audioBuffer: audioBuffer.slice(0) });
  } catch (err) {
    reply({ ok: false, error: err?.message || "Edge TTS failed" });
  }
});

window.parent.postMessage({ type: "EDGE_SYNTH_READY" }, "*");

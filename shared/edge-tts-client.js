/* global self */
/**
 * Edge TTS client — aligned with https://github.com/rany2/edge-tts
 * (constants, DRM/Sec-MS-GEC, SSML voice format, text splitting, WS protocol).
 */
const EdgeTtsClient = (() => {
  const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
  const BASE_URL = "speech.platform.bing.com/consumer/speech/synthesize/readaloud";
  const WSS_URL = `wss://${BASE_URL}/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}`;
  const VOICE_LIST_URL = `https://${BASE_URL}/voices/list?trustedclienttoken=${TRUSTED_CLIENT_TOKEN}`;
  const CHROMIUM_FULL_VERSION = "143.0.3650.75";
  const CHROMIUM_MAJOR_VERSION = CHROMIUM_FULL_VERSION.split(".", 1)[0];
  const SEC_MS_GEC_VERSION = `1-${CHROMIUM_FULL_VERSION}`;
  const WIN_EPOCH = 11644473600;
  const S_TO_NS = 1e9;
  const DEFAULT_VOICE = "vi-VN-HoaiMyNeural";
  const OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";
  const MAX_TEXT_BYTES = 4096;
  const CONNECT_TIMEOUT_MS = 10000;
  const SYNTH_TIMEOUT_MS = 60000;
  const SESSION_IDLE_MS = 45000;
  const MAX_SYNTH_RETRIES = 2;

  let clockSkewSeconds = 0;
  let cachedSecMsGec = { value: "", expiresAt: 0 };

  const BASE_HEADERS = {
    "User-Agent":
      `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR_VERSION}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR_VERSION}.0.0.0`,
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Accept-Language": "en-US,en;q=0.9",
  };

  const VOICE_HEADERS = {
    Authority: "speech.platform.bing.com",
    "Sec-CH-UA": `" Not;A Brand";v="99", "Microsoft Edge";v="${CHROMIUM_MAJOR_VERSION}", "Chromium";v="${CHROMIUM_MAJOR_VERSION}"`,
    "Sec-CH-UA-Mobile": "?0",
    Accept: "*/*",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "empty",
    ...BASE_HEADERS,
  };

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function connectId() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  function dateToString() {
    const d = new Date();
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const pad = (n) => String(n).padStart(2, "0");
    return `${days[d.getUTCDay()]} ${months[d.getUTCMonth()]} ${pad(d.getUTCDate())} ${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} GMT+0000 (Coordinated Universal Time)`;
  }

  function getUnixTimestamp() {
    return Date.now() / 1000 + clockSkewSeconds;
  }

  function parseRfc2616Date(date) {
    const parsed = Date.parse(date);
    return Number.isFinite(parsed) ? parsed / 1000 : null;
  }

  function adjustClockSkewFromServerDate(dateHeader) {
    const serverDate = parseRfc2616Date(dateHeader);
    if (serverDate == null) return;
    clockSkewSeconds += serverDate - getUnixTimestamp();
    invalidateSecMsGec();
  }

  function invalidateSecMsGec() {
    cachedSecMsGec = { value: "", expiresAt: 0 };
  }

  async function generateSecMsGec() {
    const now = Date.now();
    if (cachedSecMsGec.value && cachedSecMsGec.expiresAt > now) {
      return cachedSecMsGec.value;
    }

    let ticks = getUnixTimestamp() + WIN_EPOCH;
    ticks -= ticks % 300;
    const windowsTicks = BigInt(Math.trunc(ticks * (S_TO_NS / 100)));
    const strToHash = `${windowsTicks}${TRUSTED_CLIENT_TOKEN}`;
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(strToHash));
    const value = Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
    cachedSecMsGec = { value, expiresAt: now + 4 * 60 * 1000 };
    return value;
  }

  function removeIncompatibleCharacters(str) {
    return [...str]
      .map((char) => {
        const code = char.charCodeAt(0);
        if ((code >= 0 && code <= 8) || (code >= 11 && code <= 12) || (code >= 14 && code <= 31)) {
          return " ";
        }
        return char;
      })
      .join("");
  }

  function escapeXml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function findLastNewlineOrSpaceWithinLimit(bytes, limit) {
    const end = Math.min(limit, bytes.length);
    for (let i = end - 1; i >= 0; i -= 1) {
      if (bytes[i] === 0x0a || bytes[i] === 0x20) return i;
    }
    return -1;
  }

  function findSafeUtf8SplitPoint(bytes) {
    let splitAt = bytes.length;
    while (splitAt > 0) {
      try {
        new TextDecoder("utf-8", { fatal: true }).decode(bytes.slice(0, splitAt));
        return splitAt;
      } catch {
        splitAt -= 1;
      }
    }
    return splitAt;
  }

  function adjustSplitPointForXmlEntity(bytes, splitAt) {
    while (splitAt > 0 && bytes.slice(0, splitAt).includes(0x26)) {
      let ampersandIndex = -1;
      for (let i = splitAt - 1; i >= 0; i -= 1) {
        if (bytes[i] === 0x26) {
          ampersandIndex = i;
          break;
        }
      }
      if (ampersandIndex < 0) break;

      let hasSemicolon = false;
      for (let i = ampersandIndex; i < splitAt; i += 1) {
        if (bytes[i] === 0x3b) {
          hasSemicolon = true;
          break;
        }
      }
      if (hasSemicolon) break;
      splitAt = ampersandIndex;
    }
    return splitAt;
  }

  function splitTextByByteLength(text, byteLength = MAX_TEXT_BYTES) {
    let bytes = new TextEncoder().encode(text);
    const chunks = [];

    while (bytes.length > byteLength) {
      let splitAt = findLastNewlineOrSpaceWithinLimit(bytes, byteLength);
      if (splitAt < 0) splitAt = findSafeUtf8SplitPoint(bytes);
      splitAt = adjustSplitPointForXmlEntity(bytes, splitAt);

      if (splitAt < 0) {
        throw new Error("Edge TTS: text chunk limit too small");
      }

      const chunk = new TextDecoder().decode(bytes.slice(0, splitAt)).trim();
      if (chunk) chunks.push(chunk);

      bytes = bytes.slice(splitAt > 0 ? splitAt : 1);
    }

    const remaining = new TextDecoder().decode(bytes).trim();
    if (remaining) chunks.push(remaining);
    return chunks;
  }

  function normalizeVoiceName(voice) {
    const raw = voice || DEFAULT_VOICE;
    if (raw.startsWith("Microsoft Server Speech Text to Speech Voice")) {
      return raw;
    }

    const match = raw.match(/^([a-z]{2,})-([A-Z]{2,})-(.+Neural)$/);
    if (!match) return raw;

    let [, lang, region, name] = match;
    if (name.includes("-")) {
      region = `${region}-${name.slice(0, name.indexOf("-"))}`;
      name = name.slice(name.indexOf("-") + 1);
    }

    return `Microsoft Server Speech Text to Speech Voice (${lang}-${region}, ${name})`;
  }

  function rateToProsody(rate) {
    const clamped = Math.min(3, Math.max(0.5, Number(rate) || 1));
    const pct = Math.round((clamped - 1) * 100);
    return `${pct >= 0 ? "+" : ""}${pct}%`;
  }

  function buildSsml(escapedText, voice, rate, volume = "+0%", pitch = "+0Hz") {
    const voiceName = normalizeVoiceName(voice);
    return (
      "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>" +
      `<voice name='${voiceName}'>` +
      `<prosody pitch='${pitch}' rate='${rateToProsody(rate)}' volume='${volume}'>` +
      `${escapedText}</prosody></voice></speak>`
    );
  }

  function buildSpeechConfig() {
    return (
      `X-Timestamp:${dateToString()}\r\n` +
      "Content-Type:application/json; charset=utf-8\r\n" +
      "Path:speech.config\r\n\r\n" +
      '{"context":{"synthesis":{"audio":{"metadataoptions":{' +
      '"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"' +
      `},"outputFormat":"${OUTPUT_FORMAT}"}}}}\r\n`
    );
  }

  function buildSsmlMessage(requestId, ssml) {
    return (
      `X-RequestId:${requestId}\r\n` +
      "Content-Type:application/ssml+xml\r\n" +
      `X-Timestamp:${dateToString()}Z\r\n` +
      "Path:ssml\r\n\r\n" +
      ssml
    );
  }

  function parseHeaders(data) {
    const text = typeof data === "string" ? data : new TextDecoder().decode(data);
    const sep = text.indexOf("\r\n\r\n");
    const headerPart = sep >= 0 ? text.slice(0, sep) : text;
    const headers = {};
    for (const line of headerPart.split("\r\n")) {
      const idx = line.indexOf(":");
      if (idx > 0) headers[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
    return headers;
  }

  function parseBinaryMessage(data) {
    const view = new Uint8Array(data);
    if (view.length < 2) {
      throw new Error("Edge TTS: binary message missing header length");
    }

    const headerLength = (view[0] << 8) | view[1];
    if (headerLength > view.length) {
      throw new Error("Edge TTS: header length exceeds message size");
    }

    const headerBytes = view.slice(2, 2 + headerLength);
    const audioBytes = view.slice(2 + headerLength);
    const headers = parseHeaders(headerBytes);
    const path = headers.Path || "";
    const contentType = headers["Content-Type"];

    if (path !== "audio") {
      return { headers, audioBytes: new Uint8Array(0), skip: true };
    }

    if (contentType && contentType !== "audio/mpeg") {
      throw new Error("Edge TTS: unexpected audio Content-Type");
    }

    if (!contentType && audioBytes.length === 0) {
      return { headers, audioBytes: new Uint8Array(0), skip: true };
    }

    if (contentType == null && audioBytes.length > 0) {
      throw new Error("Edge TTS: audio data without Content-Type");
    }

    if (audioBytes.length === 0) {
      throw new Error("Edge TTS: audio message missing data");
    }

    return { headers, audioBytes, skip: false };
  }

  function mergeAudioChunks(chunks) {
    const total = chunks.reduce((sum, c) => sum + c.length, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    return merged.buffer;
  }

  function isRetryableEdgeError(err) {
    const msg = err?.message || "";
    return (
      msg.includes("connection closed") ||
      msg.includes("WebSocket error") ||
      msg.includes("connect timeout") ||
      msg.includes("timeout") ||
      msg.includes("no audio received") ||
      msg.includes("403")
    );
  }

  function prepareTextChunks(text) {
    if (!text?.trim()) throw new Error("Edge TTS: empty text");
    const cleaned = removeIncompatibleCharacters(text);
    const escaped = escapeXml(cleaned);
    return splitTextByByteLength(escaped, MAX_TEXT_BYTES);
  }

  function synthesizeOnce({ text, voice, rate, onChunk = null }) {
    return new Promise((resolve, reject) => {
      const requestId = connectId();
      const connectionId = connectId();
      const audioChunks = [];
      let settled = false;
      let ws = null;

      const finish = (err, result) => {
        if (settled) return;
        settled = true;
        if (ws && ws.readyState <= WebSocket.OPEN) {
          try {
            ws.close();
          } catch {
            /* ignore */
          }
        }
        if (err) reject(err);
        else resolve(result);
      };

      generateSecMsGec()
        .then((secMsGec) => {
          const url =
            `${WSS_URL}&ConnectionId=${connectionId}` +
            `&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`;
          ws = new WebSocket(url);
          ws.binaryType = "arraybuffer";

          ws.onopen = () => {
            const ssml = buildSsml(text, voice, rate);
            ws.send(buildSpeechConfig());
            ws.send(buildSsmlMessage(requestId, ssml));
          };

          ws.onmessage = (event) => {
            if (typeof event.data === "string") {
              const { Path: path } = parseHeaders(event.data);
              if (path === "turn.end") {
                if (!audioChunks.length) {
                  finish(new Error("Edge TTS: no audio received"));
                  return;
                }
                finish(null, mergeAudioChunks(audioChunks));
              }
              return;
            }

            try {
              const { audioBytes, skip } = parseBinaryMessage(event.data);
              if (skip || !audioBytes.length) return;
              audioChunks.push(audioBytes);
              if (onChunk) onChunk(new Uint8Array(audioBytes).buffer);
            } catch (err) {
              finish(err);
            }
          };

          ws.onerror = () => finish(new Error("Edge TTS: WebSocket error"));
          ws.onclose = (event) => {
            if (!settled && !audioChunks.length) {
              finish(new Error(`Edge TTS: connection closed (${event.code})`));
            }
          };

          setTimeout(() => {
            if (!settled) finish(new Error("Edge TTS: timeout"));
          }, SYNTH_TIMEOUT_MS);
        })
        .catch((err) => finish(err));
    });
  }

  async function synthesizeOnceWithRetry(options, attempt = 0) {
    try {
      return await synthesizeOnce(options);
    } catch (err) {
      if (attempt < MAX_SYNTH_RETRIES && isRetryableEdgeError(err)) {
        invalidateSecMsGec();
        clockSkewSeconds -= 30;
        await delay(500 * (attempt + 1));
        return synthesizeOnceWithRetry(options, attempt + 1);
      }
      throw err;
    }
  }

  async function listVoices() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(VOICE_LIST_URL, { signal: controller.signal });
      const serverDate = res.headers.get("Date");
      if (serverDate) adjustClockSkewFromServerDate(serverDate);
      if (!res.ok) throw new Error(`Edge voices: ${res.status}`);
      return res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  function createSession() {
    const pendingJobs = [];
    let activeJob = null;
    let idleTimer = null;

    function clearIdleTimer() {
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
    }

    function scheduleIdleClose() {
      clearIdleTimer();
      idleTimer = setTimeout(() => {
        /* session is connectionless; idle timer only clears queue bookkeeping */
      }, SESSION_IDLE_MS);
    }

    async function runJob(job) {
      clearIdleTimer();
      activeJob = job;

      try {
        const buffer = await synthesizeOnceWithRetry({
          text: job.text,
          voice: job.voice,
          rate: job.rate,
          onChunk: job.onChunk,
        });
        return buffer;
      } finally {
        activeJob = null;
      }
    }

    async function pump() {
      while (!activeJob && pendingJobs.length) {
        const job = pendingJobs.shift();
        try {
          const buffer = await runJob(job);
          job._resolve(buffer);
        } catch (err) {
          job._reject(err);
        }
      }
      scheduleIdleClose();
    }

    function synthesize({ text, voice, rate, priority = false, onChunk = null }) {
      return new Promise((resolve, reject) => {
        const job = { text, voice, rate, onChunk, _resolve: resolve, _reject: reject };
        if (priority) pendingJobs.unshift(job);
        else pendingJobs.push(job);
        pump();
      });
    }

    async function warmup() {
      try {
        await generateSecMsGec();
      } catch {
        invalidateSecMsGec();
      }
    }

    return {
      synthesize,
      warmup,
      get pendingCount() {
        return pendingJobs.length + (activeJob ? 1 : 0);
      },
    };
  }

  async function synthesizeWithSession(
    session,
    { text, voice, lang: _lang, rate, priority = false, onChunk = null }
  ) {
    const chunks = prepareTextChunks(text);
    const audioParts = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (!chunk) continue;
      const buffer = await session.synthesize({
        text: chunk,
        voice,
        rate,
        priority: priority && i === 0,
        onChunk: i === 0 ? onChunk : null,
      });
      audioParts.push(new Uint8Array(buffer));
    }

    if (!audioParts.length) throw new Error("Edge TTS: no audio synthesized");
    return mergeAudioChunks(audioParts);
  }

  const defaultSession = createSession();

  async function synthesize(options) {
    return synthesizeWithSession(defaultSession, options);
  }

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }

  async function synthesizeBase64(options) {
    const buffer = await synthesize(options);
    return arrayBufferToBase64(buffer);
  }

  return {
    DEFAULT_VOICE,
    VOICE_LIST_URL,
    VOICE_HEADERS,
    listVoices,
    createSession,
    synthesize,
    synthesizeWithSession,
    synthesizeBase64,
  };
})();

if (typeof self !== "undefined") {
  self.EdgeTtsClient = EdgeTtsClient;
}

if (typeof window !== "undefined") {
  window.EdgeTtsClient = EdgeTtsClient;
}

/* global self */
const EdgeTtsClient = (() => {
  const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
  const BASE_URL = "speech.platform.bing.com/consumer/speech/synthesize/readaloud";
  const WSS_BASE = `wss://${BASE_URL}/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}`;
  const VOICE_LIST_URL = `https://${BASE_URL}/voices/list?trustedclienttoken=${TRUSTED_CLIENT_TOKEN}`;
  const CHROMIUM_FULL_VERSION = "143.0.3650.75";
  const CHROMIUM_MAJOR_VERSION = CHROMIUM_FULL_VERSION.split(".")[0];
  const SEC_MS_GEC_VERSION = `1-${CHROMIUM_FULL_VERSION}`;
  const WIN_EPOCH = 11644473600;
  const DEFAULT_VOICE = "vi-VN-HoaiMyNeural";
  let cachedSecMsGec = { value: "", expiresAt: 0 };

  const VOICE_HEADERS = {
    Authority: "speech.platform.bing.com",
    "User-Agent":
      `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR_VERSION}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR_VERSION}.0.0.0`,
    "Sec-CH-UA": `" Not;A Brand";v="99", "Microsoft Edge";v="${CHROMIUM_MAJOR_VERSION}", "Chromium";v="${CHROMIUM_MAJOR_VERSION}"`,
    "Sec-CH-UA-Mobile": "?0",
    Accept: "*/*",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "empty",
    "Accept-Language": "en-US,en;q=0.9",
  };

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

  async function generateSecMsGec() {
    const now = Date.now();
    if (cachedSecMsGec.value && cachedSecMsGec.expiresAt > now) {
      return cachedSecMsGec.value;
    }

    const ticks = Math.floor(now / 1000) + WIN_EPOCH;
    const rounded = ticks - (ticks % 300);
    const windowsTicks = BigInt(rounded) * 10000000n;
    const strToHash = `${windowsTicks}${TRUSTED_CLIENT_TOKEN}`;
    const data = new TextEncoder().encode(strToHash);
    const hash = await crypto.subtle.digest("SHA-256", data);
    const value = Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
    cachedSecMsGec = { value, expiresAt: now + 4 * 60 * 1000 };
    return value;
  }

  function escapeXml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
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

  function rateToProsody(rate) {
    const clamped = Math.min(3, Math.max(0.5, Number(rate) || 1));
    const pct = Math.round((clamped - 1) * 100);
    return `${pct >= 0 ? "+" : ""}${pct}%`;
  }

  function buildSsml(text, voice, lang, rate) {
    const escaped = escapeXml(removeIncompatibleCharacters(text));
    const ssmlLang = lang || "vi-VN";
    const prosodyRate = rateToProsody(rate);
    return (
      `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${ssmlLang}'>` +
      `<voice name='${voice || DEFAULT_VOICE}'>` +
      `<prosody pitch='+0Hz' rate='${prosodyRate}' volume='+0%'>` +
      `${escaped}</prosody></voice></speak>`
    );
  }

  function parseHeaders(data) {
    const text = typeof data === "string" ? data : new TextDecoder().decode(data);
    const sep = text.indexOf("\r\n\r\n");
    const headerPart = sep >= 0 ? text.slice(0, sep) : text;
    const body = sep >= 0 ? text.slice(sep + 4) : "";
    const headers = {};
    for (const line of headerPart.split("\r\n")) {
      const idx = line.indexOf(":");
      if (idx > 0) headers[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
    return { headers, body };
  }

  function parseBinaryMessage(data) {
    const view = new Uint8Array(data);
    const headerLength = (view[0] << 8) | view[1];
    const headerBytes = view.slice(2, 2 + headerLength);
    const audioBytes = view.slice(2 + headerLength);
    const headerText = new TextDecoder().decode(headerBytes);
    const headers = {};
    for (const line of headerText.split("\r\n")) {
      const idx = line.indexOf(":");
      if (idx > 0) headers[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
    return { headers, audioBytes };
  }

  async function listVoices() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      // Plain fetch — custom headers can hang or fail in Brave popup.
      const res = await fetch(VOICE_LIST_URL, { signal: controller.signal });
      if (!res.ok) throw new Error(`Edge voices: ${res.status}`);
      return res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  function synthesizeChunk(text, voice, lang, rate, attempt = 0) {
    return new Promise((resolve, reject) => {
      const requestId = connectId();
      const connectionId = connectId();
      let audioChunks = [];
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
            `${WSS_BASE}&ConnectionId=${connectionId}` +
            `&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`;
          ws = new WebSocket(url);
          ws.binaryType = "arraybuffer";

          ws.onopen = () => {
            const configMsg =
              `X-Timestamp:${dateToString()}\r\n` +
              "Content-Type:application/json; charset=utf-8\r\n" +
              "Path:speech.config\r\n\r\n" +
              '{"context":{"synthesis":{"audio":{"metadataoptions":{' +
              '"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"' +
              '},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n';

            const ssml = buildSsml(text, voice, lang, rate);
            const ssmlMsg =
              `X-RequestId:${requestId}\r\n` +
              "Content-Type:application/ssml+xml\r\n" +
              `X-Timestamp:${dateToString()}Z\r\n` +
              "Path:ssml\r\n\r\n" +
              ssml;

            ws.send(configMsg);
            ws.send(ssmlMsg);
          };

          ws.onmessage = (event) => {
            if (typeof event.data === "string") {
              const { headers } = parseHeaders(event.data);
              if (headers.Path === "turn.end") {
                if (!audioChunks.length) {
                  finish(new Error("Edge TTS: no audio received"));
                  return;
                }
                const total = audioChunks.reduce((sum, c) => sum + c.length, 0);
                const merged = new Uint8Array(total);
                let offset = 0;
                for (const chunk of audioChunks) {
                  merged.set(chunk, offset);
                  offset += chunk.length;
                }
                finish(null, merged.buffer);
              }
              return;
            }

            const { headers, audioBytes } = parseBinaryMessage(event.data);
            if (headers.Path !== "audio" || !audioBytes.length) return;
            audioChunks.push(audioBytes);
          };

          ws.onerror = () => {
            if (attempt < 1) {
              synthesizeChunk(text, voice, lang, rate, attempt + 1).then(resolve).catch(reject);
              return;
            }
            finish(new Error("Edge TTS: WebSocket error"));
          };
          ws.onclose = (event) => {
            if (!settled && !audioChunks.length) {
              if (attempt < 1) {
                synthesizeChunk(text, voice, lang, rate, attempt + 1).then(resolve).catch(reject);
                return;
              }
              finish(new Error(`Edge TTS: connection closed (${event.code})`));
            }
          };

          setTimeout(() => {
            if (!settled) finish(new Error("Edge TTS: timeout"));
          }, 45000);
        })
        .catch((err) => finish(err));
    });
  }

  function createSession() {
    let ws = null;
    let configured = false;
    let connecting = null;
    let activeJob = null;
    const pendingJobs = [];
    let idleTimer = null;
    let audioChunks = [];

    function buildConfigMsg() {
      return (
        `X-Timestamp:${dateToString()}\r\n` +
        "Content-Type:application/json; charset=utf-8\r\n" +
        "Path:speech.config\r\n\r\n" +
        '{"context":{"synthesis":{"audio":{"metadataoptions":{' +
        '"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"' +
        '},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n'
      );
    }

    function clearIdleTimer() {
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
    }

    function scheduleIdleClose() {
      clearIdleTimer();
      idleTimer = setTimeout(() => {
        if (!activeJob && !pendingJobs.length && ws) {
          try {
            ws.close();
          } catch {
            /* ignore */
          }
          ws = null;
          configured = false;
        }
      }, 25000);
    }

    function resetSocket() {
      ws = null;
      configured = false;
      connecting = null;
    }

    function attachHandlers(socket) {
      socket.onmessage = (event) => {
        if (!activeJob) return;

        if (typeof event.data === "string") {
          const { headers } = parseHeaders(event.data);
          if (headers.Path === "turn.end") {
            const job = activeJob;
            activeJob = null;
            if (!audioChunks.length) {
              job.reject(new Error("Edge TTS: no audio received"));
            } else {
              const total = audioChunks.reduce((sum, c) => sum + c.length, 0);
              const merged = new Uint8Array(total);
              let offset = 0;
              for (const chunk of audioChunks) {
                merged.set(chunk, offset);
                offset += chunk.length;
              }
              job.resolve(merged.buffer);
            }
            audioChunks = [];
            pump();
            scheduleIdleClose();
          }
          return;
        }

        const { headers, audioBytes } = parseBinaryMessage(event.data);
        if (headers.Path !== "audio" || !audioBytes.length) return;
        audioChunks.push(audioBytes);
      };

      socket.onerror = () => {
        if (!activeJob && !pendingJobs.length) return;
        const jobs = activeJob ? [activeJob, ...pendingJobs.splice(0)] : pendingJobs.splice(0);
        activeJob = null;
        audioChunks = [];
        resetSocket();
        for (const job of jobs) job.reject(new Error("Edge TTS: WebSocket error"));
        scheduleIdleClose();
      };

      socket.onclose = () => {
        if (ws !== socket) return;
        if (activeJob) {
          const job = activeJob;
          activeJob = null;
          audioChunks = [];
          job.reject(new Error("Edge TTS: connection closed"));
        }
        resetSocket();
        scheduleIdleClose();
      };
    }

    async function ensureConnection() {
      if (ws?.readyState === WebSocket.OPEN) return ws;
      if (connecting) return connecting;

      connecting = (async () => {
        const secMsGec = await generateSecMsGec();
        const connectionId = connectId();
        const url =
          `${WSS_BASE}&ConnectionId=${connectionId}` +
          `&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`;
        const socket = new WebSocket(url);
        socket.binaryType = "arraybuffer";
        attachHandlers(socket);

        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("Edge TTS: connect timeout")), 15000);
          socket.addEventListener(
            "open",
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true }
          );
          socket.addEventListener(
            "error",
            () => {
              clearTimeout(timer);
              reject(new Error("Edge TTS: WebSocket error"));
            },
            { once: true }
          );
        });

        ws = socket;
        configured = false;
        return socket;
      })();

      try {
        return await connecting;
      } finally {
        connecting = null;
      }
    }

    async function runJob(job) {
      clearIdleTimer();
      audioChunks = [];
      activeJob = job;

      const socket = await ensureConnection();
      if (!configured) {
        socket.send(buildConfigMsg());
        configured = true;
      }

      const requestId = connectId();
      const ssml = buildSsml(job.text, job.voice, job.lang, job.rate);
      const ssmlMsg =
        `X-RequestId:${requestId}\r\n` +
        "Content-Type:application/ssml+xml\r\n" +
        `X-Timestamp:${dateToString()}Z\r\n` +
        "Path:ssml\r\n\r\n" +
        ssml;

      socket.send(ssmlMsg);

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          if (activeJob === job) {
            activeJob = null;
            audioChunks = [];
            resetSocket();
            reject(new Error("Edge TTS: timeout"));
            pump();
            scheduleIdleClose();
          }
        }, 45000);

        job.resolve = (buffer) => {
          clearTimeout(timer);
          resolve(buffer);
        };
        job.reject = (err) => {
          clearTimeout(timer);
          reject(err);
        };
      });
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

    function synthesize({ text, voice, lang, rate }) {
      return new Promise((resolve, reject) => {
        pendingJobs.push({ text, voice, lang, rate, _resolve: resolve, _reject: reject });
        pump();
      });
    }

    return {
      synthesize,
      get pendingCount() {
        return pendingJobs.length + (activeJob ? 1 : 0);
      },
    };
  }

  function splitTextIntoChunks(text) {
    if (!text?.trim()) throw new Error("Edge TTS: empty text");
    const encoder = new TextEncoder();
    const bytes = encoder.encode(removeIncompatibleCharacters(text));
    const maxChunk = 4096;
    const chunks = [];

    if (bytes.length <= maxChunk) {
      chunks.push(text);
    } else {
      let offset = 0;
      while (offset < bytes.length) {
        let end = Math.min(offset + maxChunk, bytes.length);
        while (end > offset) {
          try {
            new TextDecoder("utf-8", { fatal: true }).decode(bytes.slice(offset, end));
            break;
          } catch {
            end -= 1;
          }
        }
        if (end <= offset) end = Math.min(offset + 1, bytes.length);
        chunks.push(new TextDecoder().decode(bytes.slice(offset, end)).trim());
        offset = end;
      }
    }
    return chunks;
  }

  async function synthesizeWithSession(session, { text, voice, lang, rate }) {
    const chunks = splitTextIntoChunks(text);
    const audioParts = [];
    for (const chunk of chunks) {
      if (!chunk) continue;
      const buffer = await session.synthesize({ text: chunk, voice, lang, rate });
      audioParts.push(new Uint8Array(buffer));
    }

    if (!audioParts.length) throw new Error("Edge TTS: no audio synthesized");

    const total = audioParts.reduce((sum, p) => sum + p.length, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const part of audioParts) {
      merged.set(part, offset);
      offset += part.length;
    }
    return merged.buffer;
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

/* global chrome */
const EDGE_TTS_WS_RULE_ID = 9001;
let edgeDnrConfigured = false;
let edgeDnrPending = null;
let edgeMuid = null;

function ensureEdgeTtsWsHeaders() {
  if (edgeDnrConfigured) return Promise.resolve();
  if (edgeDnrPending) return edgeDnrPending;
  if (!chrome.declarativeNetRequest?.updateDynamicRules) return Promise.resolve();

  if (!edgeMuid) {
    edgeMuid = crypto.randomUUID().replace(/-/g, "").toUpperCase();
  }

  const origin = `chrome-extension://${chrome.runtime.id}`;
  edgeDnrPending = chrome.declarativeNetRequest
    .updateDynamicRules({
      removeRuleIds: [EDGE_TTS_WS_RULE_ID],
      addRules: [
        {
          id: EDGE_TTS_WS_RULE_ID,
          priority: 1,
          action: {
            type: "modifyHeaders",
            requestHeaders: [
              {
                header: "User-Agent",
                operation: "set",
                value:
                  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0",
              },
              { header: "Origin", operation: "set", value: origin },
              {
                header: "sec-ch-ua",
                operation: "set",
                value: '"Not(A:Brand";v="99", "Microsoft Edge";v="143", "Chromium";v="143"',
              },
              { header: "sec-ch-ua-mobile", operation: "set", value: "?0" },
              { header: "sec-ch-ua-platform", operation: "set", value: '"macOS"' },
              {
                header: "sec-ch-ua-full-version-list",
                operation: "set",
                value:
                  '"Not(A:Brand";v="99.0.0.0", "Microsoft Edge";v="143.0.3650.75", "Chromium";v="143.0.3650.75"',
              },
              { header: "Cookie", operation: "set", value: `muid=${edgeMuid};` },
              { header: "Pragma", operation: "set", value: "no-cache" },
              { header: "Cache-Control", operation: "set", value: "no-cache" },
            ],
          },
          condition: {
            regexFilter: "^wss://speech\\.platform\\.bing\\.com/",
            resourceTypes: ["websocket"],
          },
        },
      ],
    })
    .then(() => {
      edgeDnrConfigured = true;
    })
    .finally(() => {
      edgeDnrPending = null;
    });

  return edgeDnrPending;
}

if (typeof self !== "undefined") {
  self.ensureEdgeTtsWsHeaders = ensureEdgeTtsWsHeaders;
}

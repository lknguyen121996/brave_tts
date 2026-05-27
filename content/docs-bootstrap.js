(function () {
  const extId = typeof chrome !== "undefined" && chrome.runtime?.id;
  if (!extId) return;

  function injectPageBridge() {
    if (document.querySelector("script[data-brave-tts-docs-page='1']")) return;
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL(`content/docs-page.js?extId=${encodeURIComponent(extId)}`);
    script.dataset.braveTtsDocsPage = "1";
    script.dataset.extId = extId;
    script.async = false;
    (document.documentElement || document.head || document).appendChild(script);
  }

  injectPageBridge();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectPageBridge, { once: true });
  }
})();

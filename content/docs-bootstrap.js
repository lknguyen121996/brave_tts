(function () {
  const extId = typeof chrome !== "undefined" && chrome.runtime?.id;
  if (!extId) return;

  function injectInline(code) {
    const script = document.createElement("script");
    script.textContent = code;
    (document.documentElement || document.head || document).appendChild(script);
    script.remove();
  }

  injectInline(`(function(){try{window._docs_annotate_canvas_by_ext=${JSON.stringify(extId)};}catch(e){}})();`);

  function injectPageBridge() {
    if (document.querySelector("script[data-brave-tts-docs-page='1']")) return;
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("content/docs-page.js");
    script.dataset.braveTtsDocsPage = "1";
    script.dataset.extId = extId;
    script.async = false;
    (document.documentElement || document.head || document).appendChild(script);
  }

  injectPageBridge();
  document.addEventListener("DOMContentLoaded", injectPageBridge, { once: true });
})();

const path = require("path");
const { launchWithExtension, getExtensionId, pass, fail } = require("./lib/helpers");

const PROFILE = path.join(__dirname, ".e2e-profile-popup");

async function openPopup(context, extId) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extId}/popup/popup.html`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(600);
  return page;
}

(async () => {
  let context;
  try {
    const fs = require("fs");
    fs.rmSync(PROFILE, { recursive: true, force: true });

    context = await launchWithExtension({ profile: PROFILE });
    const extId = await getExtensionId(context);

    // ───────────────────────────────────────
    // Test 1: Popup loads and shows default UI
    // ───────────────────────────────────────
    let popup = await openPopup(context, extId);

    const title = await popup.title();
    if (!title || title.length < 2) fail("Popup title missing");
    pass("popup loads");

    const provider = await popup.$eval("#provider", (el) => el.value);
    if (provider !== "webspeech") fail(`Expected webspeech, got ${provider}`);
    pass("default provider is webspeech");

    // ───────────────────────────────────────
    // Test 2: Language selector has options
    // ───────────────────────────────────────
    const langOptions = await popup.$$eval("#lang option", (opts) =>
      opts.map((o) => ({ value: o.value, text: o.textContent })).filter((o) => o.value)
    );
    if (langOptions.length < 3) fail(`Too few language options: ${langOptions.length}`);
    pass(`language selector has ${langOptions.length} options`);

    // ───────────────────────────────────────
    // Test 3: UI language toggle works
    // ───────────────────────────────────────
    await popup.selectOption("#uiLang", "en");
    await popup.waitForTimeout(300);
    const subtitleEn = await popup.$eval("[data-i18n='popup.subtitle']", (el) => el.textContent);
    if (!subtitleEn.includes("Read aloud")) fail(`UI lang EN failed: ${subtitleEn}`);
    pass("UI switches to English");

    await popup.selectOption("#uiLang", "vi");
    await popup.waitForTimeout(300);
    const subtitleVi = await popup.$eval("[data-i18n='popup.subtitle']", (el) => el.textContent);
    if (!subtitleVi.includes("Đọc to")) fail(`UI lang VI failed: ${subtitleVi}`);
    pass("UI switches to Vietnamese");

    // ───────────────────────────────────────
    // Test 4: Provider switch shows/hides sections
    // ───────────────────────────────────────
    await popup.selectOption("#provider", "azure");
    await popup.waitForTimeout(200);
    const azureVisible = await popup.$eval("#azureSettings", (el) => el.hidden === false);
    if (!azureVisible) fail("Azure section not visible");
    pass("provider switch → Azure fields visible");

    await popup.selectOption("#provider", "edge");
    await popup.waitForTimeout(200);
    const azureHidden = await popup.$eval("#azureSettings", (el) => el.hidden);
    if (!azureHidden) fail("Azure section still visible after switching away");
    pass("provider switch → Azure fields hidden");

    // ───────────────────────────────────────
    // Test 5: Speed slider updates display
    // ───────────────────────────────────────
    await popup.$eval("#rate", (el) => { el.value = "1.5"; el.dispatchEvent(new Event("input")); });
    await popup.waitForTimeout(100);
    const rateDisplay = await popup.$eval("#rateValue", (el) => el.textContent);
    if (rateDisplay !== "1.5") fail(`Rate display not updated: ${rateDisplay}`);
    pass("speed slider updates");

    // ───────────────────────────────────────
    // Test 6: Settings persist across reopen
    // ───────────────────────────────────────
    await popup.selectOption("#provider", "edge");
    await popup.selectOption("#uiLang", "en");
    await popup.waitForTimeout(300);
    await popup.close();

    // Small wait for chrome.storage.sync to flush
    await popup.context().pages()[0]?.waitForTimeout(400);

    popup = await openPopup(context, extId);
    const persistedProvider = await popup.$eval("#provider", (el) => el.value);
    const persistedLang = await popup.$eval("#uiLang", (el) => el.value);
    if (persistedProvider !== "edge") fail(`Provider not persisted: ${persistedProvider}`);
    if (persistedLang !== "en") fail(`UI lang not persisted: ${persistedLang}`);
    pass("settings persist across popup reopen");
    await popup.close();

    // ───────────────────────────────────────
    // Test 7: Edge voice list loads
    // ───────────────────────────────────────
    popup = await openPopup(context, extId);
    await popup.selectOption("#provider", "edge");
    await popup.selectOption("#lang", "en-US");
    await popup.waitForTimeout(2500); // wait for Edge API

    const edgeOptions = await popup.$$eval("#edgeVoice option", (opts) =>
      opts.filter((o) => o.value).length
    );
    if (edgeOptions < 2) fail(`Expected >=2 Edge voices, got ${edgeOptions}`);
    pass(`Edge voices loaded: ${edgeOptions} options`);

    // ───────────────────────────────────────
    // Test 8: Play button validates input
    // ───────────────────────────────────────
    // With no active tab, should show error
    await popup.click("#btnPlay");
    await popup.waitForTimeout(500);
    const statusText = await popup.$eval("#status", (el) => el.textContent || "");
    if (!statusText) fail("No status message after clicking play");
    pass(`play validation shows: "${statusText}"`);
    await popup.close();

    console.log("\n✅ All popup tests passed\n");
  } catch (err) {
    fail(err.message || String(err));
  } finally {
    if (context) await context.close().catch(() => {});
  }
})();

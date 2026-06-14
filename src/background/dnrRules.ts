// ============================================================
// DNR Rules — V2-03 Tier 1: HTTP/S PDF/EPUB Redirect
// ============================================================
//
// Registers two dynamic declarativeNetRequest rules on
// install/startup that redirect top-level navigation to
// PDF/EPUB URLs into the extension's internal viewer pages.
//
// Rule 1001: *.pdf  → pdf-viewer/index.html#url=<original>
// Rule 1002: *.epub → epub-viewer/index.html#url=<original>
//
// The original URL is embedded in the hash fragment to
// preserve `&`, `?`, and `#` characters without percent-
// encoding conflicts.
//
// Rules are dynamic (not static in manifest.json) so that:
//   1. `chrome.runtime.id` is available at runtime
//   2. Rules can be updated/removed without extension update
//
// See: DECISIONS.md § "Hybrid Interception"

import { DNR_RULE_IDS, ALL_DNR_RULE_IDS } from "@shared/interception";

/**
 * Register dynamic DNR rules for PDF/EPUB HTTP/S redirect.
 *
 * Idempotent: removes existing rules first, then adds fresh ones.
 * Silently catches permission/availability errors — DNR rules
 * are non-critical (content script interception is the fallback).
 */
export async function initDnrRules(): Promise<void> {
  try {
    const extId = chrome.runtime.id;

    const { RuleActionType, ResourceType } = chrome.declarativeNetRequest;

    const rules: chrome.declarativeNetRequest.Rule[] = [
      {
        id: DNR_RULE_IDS.PDF_REDIRECT,
        priority: 1,
        action: {
          type: RuleActionType.REDIRECT,
          redirect: {
            // \0 = entire matched URL; embedded in hash to preserve chars
            regexSubstitution:
              `chrome-extension://${extId}/src/pages/pdf-viewer/index.html#url=\\0`,
          },
        },
        condition: {
          regexFilter: String.raw`^https?://.*\.pdf([?#].*)?$`,
          resourceTypes: [ResourceType.MAIN_FRAME],
        },
      },
      {
        id: DNR_RULE_IDS.EPUB_REDIRECT,
        priority: 1,
        action: {
          type: RuleActionType.REDIRECT,
          redirect: {
            regexSubstitution:
              `chrome-extension://${extId}/src/pages/epub-viewer/index.html#url=\\0`,
          },
        },
        condition: {
          regexFilter: String.raw`^https?://.*\.epub([?#].*)?$`,
          resourceTypes: [ResourceType.MAIN_FRAME],
        },
      },
    ];

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [...ALL_DNR_RULE_IDS],
      addRules: rules,
    });
  } catch (err) {
    // Gracefully handle environments without DNR support or
    // when the permission is revoked
    console.warn(
      "[Brave Read Aloud] Failed to register DNR rules:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

/**
 * Remove all DNR rules registered by this extension.
 * Used when the user disables PDF/EPUB interception in settings
 * (future: preferences panel integration).
 */
export async function removeDnrRules(): Promise<void> {
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [...ALL_DNR_RULE_IDS],
    });
  } catch {
    // Silently ignore — rules may not have been registered
  }
}

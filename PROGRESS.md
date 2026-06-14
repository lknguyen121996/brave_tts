# Progress: Brave Read Aloud

**Last updated:** 2026-06-14

## Overview
- **Bug fixes:** 12/12 passing (7 P0 + 3 P1 + 2 P2)
- **Features:** 0/8 verified
- **Build:** ✅ JS syntax all files passing
- **Test:** ✅ 3/3 passing (UI: hover play, jump, back-on-track)

## Completed (this session)

### P0 — Bugs (7/7)
- [bug-01] Fix infinite retry loop in setRate → `for (retry < 2)` + paused guard
- [bug-02] Fix scroll listener leak → `detachScrollTracking()` in `stopReading()`
- [bug-03] Fix Edge iframe leak → `edgeFrame.remove()` in `stopReading()`
- [bug-04] Fix highlight crash on cross-node segments → startContainer guard
- [bug-05] Fix ontimeupdate leak → `audio.ontimeupdate = null` in cleanup
- [bug-06] Fix translation comparison fragile → `data-status` attribute
- [bug-07] Fix docs extract fragile → safety timeout for listener removal

### P1 — Fixes (3/3)
- [fix-01] Code cleanup: dead hoverPointer code, ensureVoices clearTimeout, speakEdge simplify
- [fix-02] Popup UX: setSelectLoading() helper, disable select during fetch
- [fix-03] Robustness: randomUUID fallback via getRandomValues

### P2 — Polish (2/2)
- [polish-01] SPLIT_TEXT_REGEX exported via API, naming/architecture notes
- [polish-02] Test profiles in .gitignore, DOCS_URL configurable via env var

### Core fix (this session)
- **Hover debounce**: mousemove + pointermove batched via requestAnimationFrame → button stable

## In Progress

*(None)*

## Not Started

- feat-01 → feat-08: Feature verification pending

## Issues

- None

## Next Steps

1. Verify feat-01 (Web Speech TTS) → `cd test && npm test`
2. Verify feat-02 (Hover Play & Jump) → `cd test && npm test`
3. Continue verifying remaining features in dependency order

## Links

- Feature list: [feature_list.json](feature_list.json)
- Decision log: [DECISIONS.md](DECISIONS.md)
- Agent routing: [AGENTS.md](AGENTS.md)

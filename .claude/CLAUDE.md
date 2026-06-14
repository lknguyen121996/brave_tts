# Brave Read Aloud — Claude Code Configuration

## Project

Chrome/Brave extension TTS — đọc văn bản trang web, highlight, auto-scroll. 4 TTS providers. Xem [AGENTS.md](../AGENTS.md) để biết chi tiết.

## Work-in-Progress Rule (WIP=1)

- Only one feature active at a time
- Do not modify code outside the current feature's scope
- Complete (verification PASS) before switching
- New ideas → write to DECISIONS.md, do not code immediately

## Verification Layers

Before declaring "done":
1. **Syntax:** No JS errors in all files (check manually or via ESLint if available)
2. **Test:** `cd test && npm test` passes (UI test suite)
3. **E2E:** Run the specific feature's verification command from feature_list.json

## Clean State (End of Session)

- Build: All files parse without errors
- Test: Existing tests pass, no regressions
- Progress: feature_list.json and PROGRESS.md updated
- Artifacts: No debug logs, temp files, uncommitted TODOs
- Bootstrap: `bash init.sh` still works

## Review Process

- New code must pass evaluator before marking feature as "passing"
- Evaluator runs independently from implementer
- Repeated mistakes → promote to automated check

## Rules & Skills

- `.claude/rules/01-wip1.md` — WIP=1 discipline
- `.claude/rules/02-verification.md` — 3 verification layers
- `.claude/rules/03-clean-state.md` — 5 clean dimensions
- `.claude/rules/04-handoff.md` — Multi-session handoff
- `.claude/skills/init-session.md` — Session startup checklist
- `.claude/agents/evaluator.md` — Independent reviewer

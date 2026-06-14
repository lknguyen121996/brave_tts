# Rule: Multi-Session Handoff

## Problem

Claude Code loses context between sessions. Without handoff artifacts, the next session spends 30-60 minutes re-understanding the project.

## The Three Handoff Artifacts

### 1. PROGRESS.md — Current State (update at END of every session)

Format: Completed → In Progress → Not Started → Issues → Next Steps → Links

### 2. DECISIONS.md — Decision Log

Format: `| Date | Decision | Rationale | Alternatives Considered |`

### 3. Git Commit — Checkpoint

```bash
git add -A
git commit -m "feat: feat-0X feature-name

- What was built
- Verification result
- Updated feature_list.json

Next: feat-0Y next-feature"
```

## End of Session Checklist

1. Read feature_list.json, update state for completed features
2. Read PROGRESS.md, add new entry with today's timestamp
3. If any architectural decisions were made, add to DECISIONS.md
4. Verify: tests pass, no regressions
5. Delete temp files, debug logs, console.log
6. Git add, commit with descriptive message

## New Session Startup

```bash
# Read handoff artifacts
cat PROGRESS.md
node -e "const f=require('./feature_list.json'); f.forEach(x => console.log(x.id, x.state, x.title))"

# Run init
bash init.sh

# The agent should confirm environment is ready and feature list is correct
```

## Handoff Quality Checklist

| Criterion | Check |
|-----------|-------|
| Tests | Existing tests pass? |
| Feature state | All features have correct state? |
| Git status | Working tree is clean? |
| Temp artifacts | No .log, temp, or debug files? |
| PROGRESS.md | Updated with this session's timestamp? |
| Next steps | List of next steps exists? |

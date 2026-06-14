# Skill: Init Session

## The 4-Phase Model

```
INIT (5 min) → EXECUTE (25-50 min) → VERIFY (5-10 min) → CLEANUP (5 min)
```

## Phase 1: INIT — Warm Start

```bash
bash init.sh              # Ensure environment is ready
cat PROGRESS.md           # See current progress
node -e "const f=require('./feature_list.json'); f.forEach(x => console.log(x.id, x.state, x.title))"
```

Then confirm with the agent:
> "Read feature_list.json and PROGRESS.md. I'm working on feature feat-0X today. Confirm the environment is ready."

## Phase 2: EXECUTE — Feature Work

Work on ONE feature. WIP=1. Complete the feature, run verification.

## Phase 3: VERIFY — 3 Layers

```bash
# Layer 1: Syntax
node -c content/content.js && node -c background/background.js

# Layer 2: Test
cd test && npm test

# Layer 3: Feature verification
# Run the specific verification command from feature_list.json
```

### If verification FAILs

Loop back to Phase 2 with specific fix instructions.

## Phase 4: CLEANUP — Handoff

```
> Update PROGRESS.md with session summary.
> Update feature_list.json with correct states.
> Run: git status (must be clean or only feature-related files)
```

## Summary Checklist

| Phase | Actions | Time |
|-------|---------|------|
| INIT | bash init.sh, read feature list & progress | 5 min |
| EXECUTE | Work on ONE feature, WIP=1 | 25-50 min |
| VERIFY | 3 layers: syntax → test → feature verification | 5-10 min |
| CLEANUP | Update progress, commit, clean artifacts | 5 min |

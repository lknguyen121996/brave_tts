# Rule: Clean State — 5 Dimensions

## Principle

> The quality of state at session exit directly determines the effectiveness of the next session. "Clean later" = never clean.

## The 5 Dimensions

### 1. BUILD — Code loads without errors

- All JS files parse (`node -c <file>`)
- manifest.json is valid JSON
- Extension can be loaded in Chrome/Brave without errors

### 2. TEST — No regressions

- `cd test && npm test` passes
- Existing tests must NOT regress
- New tests for new features must pass

### 3. PROGRESS — Recorded in artifacts

- `feature_list.json`: All features have correct state
- `PROGRESS.md`: Updated with today's timestamp
- `DECISIONS.md`: New decisions added if any

### 4. ARTIFACTS — No junk

No: `.log`, `.tmp`, `debug.*` files, `console.log`/`console.debug` debug statements, uncommitted TODOs/FIXMEs, `.env` with real secrets, stale browser profiles in `test/.e2e-profile-*`

### 5. BOOTSTRAP — Cold-start path works

- `bash init.sh` must succeed from scratch

## Quick Check

```bash
node -c content/content.js && node -c background/background.js && \
cd test && npm test && \
bash ../init.sh && \
git status
```

## Cleanup Command

```bash
# Remove debug statements
grep -rn "console\.\(log\|debug\)" content/ background/ popup/ | grep -v node_modules
# Clean test profiles
rm -rf test/.e2e-profile-*/.metadata

# Verify manifest
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('manifest OK')"
```

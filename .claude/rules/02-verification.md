# Rule: 3 Verification Layers

## The Three Layers

```
Layer 1: Syntax + Static Analysis → JS parse, lint, structure check   [~2 sec]
Layer 2: Runtime Behavior        → UI test suite (local HTML)         [~30 sec]
Layer 3: System-Level            → Edge TTS / Docs / full E2E         [2-15 min]
```

## When the agent says "done"

Require all 3 layers before accepting:

```
Before reporting done, run all 3 verification layers:
1. Syntax: Verify no JS errors in changed files
2. Test:  cd test && npm test
3. E2E:   {VERIFICATION_COMMAND from feature_list.json}

Send full output. Only stop when all 3 PASS.
```

## Project-Specific Commands

```bash
# Layer 1: Syntax
node -c background/background.js
node -c content/content.js
# (repeat for all changed .js files)

# Layer 2: Test
cd test && npm test

# Layer 3: Feature verification
cd test && npm run test:edge    # for Edge TTS feature
cd test && npm run test:docs    # for Google Docs feature
cd test && npm run test:all     # full E2E suite
```

## Review Feedback Promotion

Every time the agent repeats a mistake → promote it to an automated check.

```
1. Agent makes a mistake → you catch it in code review
2. Has this mistake happened before?
   - No → fix it, take a note
   - Yes → create an automated check for it
3. Add to test suite or init.sh
4. Next time the check catches it before you have to
```

## Agent-Directed Error Messages

When verification FAILs, require 3 elements:
1. What went wrong: [actual error output]
2. Why it went wrong: [root cause analysis]
3. How to fix: [specific fix instruction]

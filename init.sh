#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# init.sh — Brave Read Aloud Bootstrap
# ============================================================
# 4 Bootstrap Contract conditions:
# 1. Can start    — environment ready, dependencies installed
# 2. Can test     — at least 1 sample test passes
# 3. Can see progress — displays feature list
# 4. Can choose next   — shows unstarted features
# ============================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
BOLD='\033[1m'

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
FEATURE_LIST="$PROJECT_ROOT/feature_list.json"

section()  { echo -e "\n${BOLD}${CYAN}━━━ $1 ━━━${NC}"; }
ok()       { echo -e "  ${GREEN}✓${NC} $1"; }
warn()     { echo -e "  ${YELLOW}⚠${NC} $1"; }
fail()     { echo -e "  ${RED}✗${NC} $1"; }
info()     { echo -e "  ${CYAN}→${NC} $1"; }

# ──────────────────────────────────────────────
# STEP 1: Can start — environment ready
# ──────────────────────────────────────────────
section "1/4: Can start — checking environment"

# Check Node.js
if command -v node &>/dev/null; then
  NODE_VERSION=$(node -v)
  ok "Node.js $NODE_VERSION"
else
  fail "Node.js not found. Install from https://nodejs.org/"
  exit 1
fi

# Check npm
if command -v npm &>/dev/null; then
  NPM_VERSION=$(npm -v)
  ok "npm v$NPM_VERSION"
else
  fail "npm not found"
  exit 1
fi

# Check display (Playwright needs headed mode for extension testing)
if [ -n "${DISPLAY:-}" ] || [[ "$OSTYPE" == "darwin"* ]]; then
  ok "Display available (headed testing supported)"
  HEADED_AVAILABLE=true
else
  warn "No display detected — Playwright extension tests need headed mode"
  warn "Tests will be SKIPPED. Run on a machine with display to verify."
  HEADED_AVAILABLE=false
fi

# Install dependencies
section "Installing test dependencies..."
cd "$PROJECT_ROOT/test"
if npm install 2>&1 | tail -3; then
  ok "Dependencies installed"
else
  fail "npm install failed"
  exit 1
fi
cd "$PROJECT_ROOT"

# Check Playwright browsers
if npx playwright install chromium 2>&1 | tail -3; then
  ok "Chromium for Playwright ready"
else
  fail "Failed to install Chromium"
  exit 1
fi

# ──────────────────────────────────────────────
# STEP 2: Can test — at least 1 sample test passes
# ──────────────────────────────────────────────
section "2/4: Can test — running sample test"

cd "$PROJECT_ROOT/test"

if [ "$HEADED_AVAILABLE" = true ]; then
  info "Running UI test suite (headed Chromium)..."
  if npm test; then
    ok "UI test suite passed — bootstrap complete"
    TEST_PASSED=true
  else
    warn "UI tests did not fully pass. See output above."
    warn "Try: cd test && npm test"
    TEST_PASSED=false
  fi
else
  warn "Skipping tests: no display available."
  warn "Run manually: cd test && npm test"
  TEST_PASSED=false
fi

cd "$PROJECT_ROOT"

# ──────────────────────────────────────────────
# STEP 3: Can see progress — feature list
# ──────────────────────────────────────────────
section "3/4: Can see progress — feature list"

if [ -f "$FEATURE_LIST" ]; then
  echo ""
  echo -e "  ${BOLD}Feature${NC}                         ${BOLD}State${NC}        ${BOLD}Depends On${NC}"
  echo "  ─────────────────────────────────────────────────────"
  node -e "
    const fs = require('fs');
    const features = JSON.parse(fs.readFileSync('$FEATURE_LIST', 'utf8'));
    features.forEach(f => {
      const id = f.id.padEnd(10);
      const title = f.title.substring(0, 36).padEnd(38);
      const state = f.state.padEnd(13);
      const deps = (f.depends_on || []).join(', ') || '—';
      console.log('  ' + id + title + state + deps);
    });
  "
  echo ""

  TOTAL=$(node -e "const f=require('$FEATURE_LIST'); console.log(f.length)")
  DONE=$(node -e "const f=require('$FEATURE_LIST'); console.log(f.filter(x=>x.state==='passing').length)")
  ACTIVE=$(node -e "const f=require('$FEATURE_LIST'); console.log(f.filter(x=>x.state==='active').length)")
  BLOCKED=$(node -e "const f=require('$FEATURE_LIST'); console.log(f.filter(x=>x.state==='blocked').length)")
  TODO=$(node -e "const f=require('$FEATURE_LIST'); console.log(f.filter(x=>x.state==='not_started').length)")

  echo -e "  ${GREEN}Passing: $DONE${NC}  ${YELLOW}Active: $ACTIVE${NC}  ${RED}Blocked: $BLOCKED${NC}  Not started: $TODO  Total: $TOTAL"
  echo ""
else
  warn "feature_list.json not found at $FEATURE_LIST"
fi

# ──────────────────────────────────────────────
# STEP 4: Can choose next — first unstarted feature
# ──────────────────────────────────────────────
section "4/4: Can choose next step"

if [ -f "$FEATURE_LIST" ]; then
  node -e "
    const fs = require('fs');
    const features = JSON.parse(fs.readFileSync('$FEATURE_LIST', 'utf8'));
    const available = features.filter(f =>
      f.state === 'not_started' &&
      (f.depends_on || []).every(d => features.find(x => x.id === d)?.state === 'passing')
    );

    if (available.length === 0) {
      console.log('  All features complete or blocked! Check PROGRESS.md.');
      process.exit(0);
    }

    console.log('  Next feature to work on:');
    console.log('');
    const next = available[0];
    console.log('  [' + next.id + '] ' + next.title);
    console.log('  Description:  ' + next.description);
    console.log('  Verification: ' + next.verification);
    if (available.length > 1) {
      console.log('');
      console.log('  Other available features:');
      available.slice(1).forEach(f => console.log('    - [' + f.id + '] ' + f.title));
    }
  "
fi

# ──────────────────────────────────────────────
# Summary
# ──────────────────────────────────────────────
echo ""
echo -e "${BOLD}${CYAN}══════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}  Bootstrap complete${NC}"
echo ""
echo -e "  Cold-start answers:"
echo -e "  1. What is this?  → ${CYAN}AGENTS.md${NC} / README.md"
echo -e "  2. How organized?  → ${CYAN}AGENTS.md${NC} (Directory Structure)"
echo -e "  3. How to run?     → ${CYAN}cd test && npm test${NC}"
echo -e "  4. How to verify?  → ${CYAN}npm test | npm run test:edge | npm run test:docs${NC}"
echo -e "  5. Where are we?   → ${CYAN}PROGRESS.md${NC} / feature_list.json"
echo ""
echo -e "  Dev loop: Edit source → Reload extension → Reload tab → Run test"
echo -e "  Docs:     ${CYAN}README.md${NC} (user)  |  ${CYAN}AGENTS.md${NC} (agent route)"
echo -e "${BOLD}${CYAN}══════════════════════════════════════════════════════${NC}"

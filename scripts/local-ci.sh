#!/usr/bin/env bash
# fantastic-pi-mobile local CI — Linux only, powered by basecamp/gh-signoff.
# Mirrors .github/workflows/ci.yml (bridge + android jobs on ubuntu-latest).
# Usage:
#   scripts/local-ci.sh               stages: bridge android
#   scripts/local-ci.sh bridge        selected stages only
#   scripts/local-ci.sh --no-signoff  run checks, don't post signoff statuses
#   scripts/local-ci.sh --help        this text
set -euo pipefail

AVAILABLE_STAGES=(bridge android)
DEFAULT_STAGES=(bridge android)

_fail()   { printf '✗ %s\n' "$*" >&2; exit 1; }
_log()    { printf '▸ %s\n' "$*"; }
_ok()     { printf '✓ %s\n' "$*"; }
require() { command -v "$1" >/dev/null 2>&1 || _fail "missing '$1'${2:+ — $2}"; }

node_min() {
  require node ""
  local major; major="$(node --version | sed 's/^v//' | cut -d. -f1)"
  [ "$major" -ge "$1" ] || _fail "Node.js >= $1 required (found v$major)"
}

case "$(uname -s)" in
  Linux) ;;
  *) _fail "Linux-only local CI; refusing to run on $(uname -s) (other platforms stay in GitHub Actions)." ;;
esac

NO_SIGNOFF=0
SELECTED=()
while [ $# -gt 0 ]; do
  case "$1" in
    --no-signoff) NO_SIGNOFF=1 ;;
    --list) printf '%s\n' "stages: ${AVAILABLE_STAGES[*]}"; exit 0 ;;
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
    -*) _fail "unknown option: $1 (try --help)" ;;
    *) SELECTED+=("$1") ;;
  esac
  shift
done
[ ${#SELECTED[@]} -gt 0 ] || SELECTED=("${DEFAULT_STAGES[@]}")

if [ "$NO_SIGNOFF" = 0 ]; then
  require gh ""
  gh extension list 2>/dev/null | grep -qi "gh-signoff" \
    || _fail "gh-signoff extension missing — run: gh extension install basecamp/gh-signoff (or pass --no-signoff)"
fi

# ── stages ────────────────────────────────────────────────────────────────────

stage_bridge() {
  node_min 24
  require npm ""
  ( cd bridge && npm ci --ignore-scripts && npm test )
}

stage_android() {
  # Java 17 + Android SDK (platform-tools, android-35, build-tools 35.0.0).
  require java "Java 17 (e.g. temurin via sdkman/apt) — java -version should print \"17\""
  java -version 2>&1 | grep -qE '"17([.]|")' || _fail 'Java 17 required (java -version does not report "17")'
  [ -n "${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}" ] || command -v sdkmanager >/dev/null 2>&1 \
    || _fail "Android SDK not found — install it (ANDROID_HOME or sdkmanager on PATH; sdkmanager 'platform-tools' 'platforms;android-35' 'build-tools;35.0.0')"
  ./gradlew assembleDebug lintDebug testDebugUnitTest
}

# ── runner ────────────────────────────────────────────────────────────────────

# Run from the repo root regardless of the invocation directory — stages and
# status posting use repo-relative paths (cubic P3).
cd "$(git rev-parse --show-toplevel)" || _fail "not inside the repository"

signoff_failed=0

# Validate all selected stage names before running anything.
for s in "${SELECTED[@]}"; do
  declare -F "stage_$s" >/dev/null || _fail "unknown stage '$s' (stages: ${AVAILABLE_STAGES[*]})"
done

if [ -n "$(git status --porcelain --untracked-files=normal)" ]; then
  # gh-signoff refuses to attest a dirty tree, so fail fast BEFORE the long
  # stages instead of finishing a full run with nothing posted.
  if [ "$NO_SIGNOFF" = 0 ]; then
    _fail "working tree has uncommitted changes — commit or stash them, or pass --no-signoff"
  fi
  _log "warning: working tree has uncommitted changes — results may not match HEAD"
fi

for s in "${SELECTED[@]}"; do
  _log "stage: $s"
  # Bind every status to the exact commit the stage tests (CodeRabbit Major):
  # a commit/push landing mid-stage can no longer be green-lit by mistake.
  head_sha="$(git rev-parse HEAD)"
  # Run the stage in a subshell with errexit, OUTSIDE any if-condition context:
  # inside `if ! (...)` bash suppresses errexit, so a failing command mid-stage
  # could be masked and the stage wrongly reported green (bot review P0).
  set +e
  ( set -e; "stage_$s" )
  rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    [ "$NO_SIGNOFF" = 0 ] && gh signoff fail --commit "$head_sha" "$s" --description "$s failed locally" >/dev/null 2>&1 || true
    _fail "stage '$s' failed"
  fi
  _ok "$s passed"
  if [ "$NO_SIGNOFF" = 0 ]; then
    gh signoff --commit "$head_sha" "$s" >/dev/null 2>&1 \
      || { printf '⚠ could not post signoff status for %s — is HEAD pushed? gh authorized?\n' "$s" >&2; signoff_failed=1; }
  fi
done

# A missing required status is as bad as a failing stage (CodeRabbit Minor).
if [ "$signoff_failed" -ne 0 ]; then
  _fail "one or more signoff statuses could not be posted"
fi

if [ "$NO_SIGNOFF" = 1 ]; then
  _log "all done — no signoff statuses posted (was --no-signoff)."
else
  _log "all done."
fi

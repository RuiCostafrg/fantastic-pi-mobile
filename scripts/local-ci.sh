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
    --list) printf '%s\n' "stages: ${AVAILABLE_STAGES[*]}" ;;
    -h|--help) sed -n '2,11p' "$0" ;;
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
  java -version 2>&1 | grep -q '"17"' || _fail 'Java 17 required (java -version does not report "17")'
  [ -n "${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}" ] || command -v sdkmanager >/dev/null 2>&1 \
    || _fail "Android SDK not found — install it (ANDROID_HOME or sdkmanager on PATH; sdkmanager 'platform-tools' 'platforms;android-35' 'build-tools;35.0.0')"
  ./gradlew assembleDebug lintDebug testDebugUnitTest
}

# ── runner ────────────────────────────────────────────────────────────────────

for s in "${SELECTED[@]}"; do
  declare -F "stage_$s" >/dev/null || _fail "unknown stage '$s' (stages: ${AVAILABLE_STAGES[*]})"
  _log "stage: $s"
  if ! ( set -e; "stage_$s" ); then
    [ "$NO_SIGNOFF" = 0 ] && gh signoff fail "$s" --description "$s failed locally" >/dev/null 2>&1 || true
    _fail "stage '$s' failed"
  fi
  _ok "$s passed"
  if [ "$NO_SIGNOFF" = 0 ]; then
    gh signoff "$s" >/dev/null 2>&1 \
      || printf '⚠ could not post signoff status for %s — is HEAD pushed? gh authorized?\n' "$s" >&2
  fi
done
_log "all done${NO_SIGNOFF:+ — no signoff statuses posted (was --no-signoff)}."

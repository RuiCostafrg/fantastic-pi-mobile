#!/usr/bin/env bash
# Shared local CI runner from verified-release-kit. Linux only, powered by
# basecamp/gh-signoff.
#
# Runs a repository's check stages on your own machine and records each result
# as a signoff/<stage> commit status on the exact commit that was tested.
#
# This file is the same in every repository that uses it. Do not edit a copy:
# change it in verified-release-kit and re-sync. A repository supplies only its
# own stages, in local-ci.stages.sh next to this file. The contract for that
# file is documented in docs/local-ci.md of verified-release-kit.
set -euo pipefail

LOCAL_CI_RUNNER_VERSION=0.1.0

# ── helpers (also available to stage files) ──────────────────────────────────

_fail()   { printf '✗ %s\n' "$*" >&2; exit 1; }
_log()    { printf '▸ %s\n' "$*"; }
_ok()     { printf '✓ %s\n' "$*"; }
_warn()   { printf '⚠ %s\n' "$*" >&2; }
require() { command -v "$1" >/dev/null 2>&1 || _fail "missing '$1'${2:+ — $2}"; }

node_min() {
  require node ""
  local major; major="$(node --version | sed 's/^v//' | cut -d. -f1)"
  [ "$major" -ge "$1" ] || _fail "Node.js >= $1 required (found v$major)"
}

# ── platform and anchoring ───────────────────────────────────────────────────

case "$(uname -s)" in
  Linux) ;;
  *) _fail "Linux-only local CI; refusing to run on $(uname -s) (other platforms stay in GitHub Actions)." ;;
esac

# Resolve through symlinks so the runner anchors to the repository that owns it,
# not to the caller's working directory or to wherever a symlink points from.
runner="$(readlink -f -- "${BASH_SOURCE[0]}")" || _fail "cannot resolve runner path"

# A vendored copy carries its checksum next to it. A copy that no longer matches
# was edited in place, which is how the copies drifted apart before.
if [ -f "$(dirname -- "$runner")/local-ci.sha256" ]; then
  ( CDPATH='' cd -- "$(dirname -- "$runner")" && sha256sum --check --status local-ci.sha256 ) \
    || _fail "$(basename -- "$runner") does not match local-ci.sha256 — it was edited in place; make the change in verified-release-kit and re-sync"
fi

# The stage file decides which repository is tested and attested. It sits next
# to the runner unless a wrapper names it (submodule or downloaded runner).
stages_file="${LOCAL_CI_STAGES_FILE:-$(dirname -- "$runner")/local-ci.stages.sh}"
[ -f "$stages_file" ] || _fail "stage file not found: $stages_file"
stages_file="$(readlink -f -- "$stages_file")" || _fail "cannot resolve stage file path"
repo_root="$(git -C "$(dirname -- "$stages_file")" rev-parse --show-toplevel 2>/dev/null)" \
  || _fail "stage file is not inside a git work tree: $stages_file"
CDPATH='' cd -- "$repo_root" || _fail "cannot enter repository root: $repo_root"

# ── stage file ───────────────────────────────────────────────────────────────

LOCAL_CI_NAME="$(basename -- "$repo_root")"
LOCAL_CI_DESCRIPTION=""
LOCAL_CI_OPTIONS_HELP=""
LOCAL_CI_STAGES=()
LOCAL_CI_DEFAULT_STAGES=()

# shellcheck source=/dev/null
. "$stages_file"

_config_fail() { _fail "$(basename -- "$stages_file"): $*"; }

[ "${#LOCAL_CI_STAGES[@]}" -gt 0 ] || _config_fail "LOCAL_CI_STAGES is empty"
[ "${#LOCAL_CI_DEFAULT_STAGES[@]}" -gt 0 ] || LOCAL_CI_DEFAULT_STAGES=("${LOCAL_CI_STAGES[@]}")

_is_listed() {
  local candidate
  for candidate in "${LOCAL_CI_STAGES[@]}"; do
    [ "$candidate" != "$1" ] || return 0
  done
  return 1
}

for s in "${LOCAL_CI_STAGES[@]}"; do
  # A stage name becomes the status context signoff/<name>.
  [[ "$s" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || _config_fail "invalid stage name '$s'"
  declare -F "stage_$s" >/dev/null || _config_fail "stage '$s' is listed but stage_$s is not defined"
done
for s in "${LOCAL_CI_DEFAULT_STAGES[@]}"; do
  _is_listed "$s" || _config_fail "default stage '$s' is not in LOCAL_CI_STAGES"
done

# ── arguments ────────────────────────────────────────────────────────────────

# Generated from the stage file, so help text cannot go stale or leak code the
# way a hand-maintained `sed -n '2,Np' "$0"` line range did.
_usage() {
  printf '%s local CI — Linux only, powered by basecamp/gh-signoff.\n' "$LOCAL_CI_NAME"
  [ -z "$LOCAL_CI_DESCRIPTION" ] || printf '%s\n' "$LOCAL_CI_DESCRIPTION"
  printf '\nUsage:\n  %s [options] [stage...]\n\n' "$0"
  printf 'Stages:  %s\n' "${LOCAL_CI_STAGES[*]}"
  printf 'Default: %s\n\n' "${LOCAL_CI_DEFAULT_STAGES[*]}"
  printf 'Options:\n'
  printf '  --no-signoff  run checks, do not post signoff statuses\n'
  printf '  --list        list stages\n'
  printf '  --version     print the runner version\n'
  printf '  --help        this text\n'
  [ -z "$LOCAL_CI_OPTIONS_HELP" ] || printf '%s\n' "$LOCAL_CI_OPTIONS_HELP"
}

NO_SIGNOFF=0
SELECTED=()
while [ $# -gt 0 ]; do
  case "$1" in
    --no-signoff) NO_SIGNOFF=1 ;;
    --list) printf '%s\n' "stages: ${LOCAL_CI_STAGES[*]}"; exit 0 ;;
    --version) printf 'local-ci runner %s\n' "$LOCAL_CI_RUNNER_VERSION"; exit 0 ;;
    -h|--help) _usage; exit 0 ;;
    -*)
      # A stage file may accept its own flags by defining local_ci_option.
      if declare -F local_ci_option >/dev/null && local_ci_option "$1"; then
        :
      else
        _fail "unknown option: $1 (try --help)"
      fi
      ;;
    *) SELECTED+=("$1") ;;
  esac
  shift
done
[ ${#SELECTED[@]} -gt 0 ] || SELECTED=("${LOCAL_CI_DEFAULT_STAGES[@]}")

# Validate every selected stage before anything slow or stateful runs.
for s in "${SELECTED[@]}"; do
  _is_listed "$s" || _fail "unknown stage '$s' (stages: ${LOCAL_CI_STAGES[*]})"
done

# ── signoff plumbing ─────────────────────────────────────────────────────────

if [ "$NO_SIGNOFF" = 0 ]; then
  require gh "GitHub CLI is required for gh-signoff (or pass --no-signoff)"
  # Captured, not piped into `grep -q`: under pipefail an early grep exit can
  # kill the producer with SIGPIPE and flip the result.
  extensions="$(gh extension list 2>/dev/null)" || extensions=""
  case "$extensions" in
    *gh-signoff*) ;;
    *) _fail "gh-signoff extension missing — run: gh extension install basecamp/gh-signoff (or pass --no-signoff)" ;;
  esac
fi

signoff_failed=0

# `gh signoff --commit <sha>` attests a named commit without looking at the
# working tree, so every cleanliness guarantee has to come from this runner.
# The explicit `create` matters: without it a stage named like a gh-signoff
# command (install, check, status, …) is parsed as that command.
_post_success() {
  local stage="$1" sha="$2" out
  [ "$NO_SIGNOFF" = 0 ] || return 0
  if ! out="$(gh signoff create --commit "$sha" "$stage" 2>&1)"; then
    _warn "could not post signoff status for $stage — is the commit pushed? is gh authorized?"
    [ -z "$out" ] || printf '%s\n' "$out" | sed 's/^/    /' >&2
    signoff_failed=1
  fi
}

_post_failure() {
  local stage="$1" sha="$2" description="$3" out
  [ "$NO_SIGNOFF" = 0 ] || return 0
  if ! out="$(gh signoff fail --commit "$sha" "$stage" --description "$description" 2>&1)"; then
    _warn "could not post failing status for $stage"
    [ -z "$out" ] || printf '%s\n' "$out" | sed 's/^/    /' >&2
  fi
}

# ── integrity checks ─────────────────────────────────────────────────────────

# Always a plain assignment at the call site, never an if-condition or a
# pipeline: a git status that fails must stop the run, not read as "clean".
# --untracked-files=normal overrides status.showUntrackedFiles=no.
_worktree_status() { git status --porcelain --untracked-files=normal; }

head_sha="$(git rev-parse --verify HEAD)" || _fail "cannot resolve HEAD"
worktree_status="$(_worktree_status)" \
  || _fail "git status failed — cannot verify tree cleanliness"
if [ -n "$worktree_status" ]; then
  # Fail fast, before the long stages, instead of finishing a full run that
  # cannot be attested.
  if [ "$NO_SIGNOFF" = 0 ]; then
    _fail "working tree has uncommitted changes — commit or stash them, or pass --no-signoff"
  fi
  _log "warning: working tree has uncommitted changes — results may not match HEAD"
fi

_log "repository: $repo_root"

if declare -F prepare >/dev/null; then
  # Runs in this shell so it can export environment for the stages. The body
  # of an if-block is not a condition, so errexit still applies inside prepare.
  prepare
  CDPATH='' cd -- "$repo_root" || _fail "cannot return to repository root: $repo_root"
  prepared_status="$(_worktree_status)" \
    || _fail "git status failed — cannot verify tree cleanliness"
  if [ "$NO_SIGNOFF" = 0 ] && [ -n "$prepared_status" ]; then
    _fail "prepare left uncommitted changes in the working tree — refusing to attest"
  fi
fi

# ── runner ───────────────────────────────────────────────────────────────────

for s in "${SELECTED[@]}"; do
  # Preparation and signoff posting happen between checks. Re-check the
  # snapshot before each stage so one run cannot sign off multiple commits.
  stage_status="$(_worktree_status)" \
    || _fail "git status failed — cannot verify tree cleanliness"
  stage_sha="$(git rev-parse --verify HEAD)" || _fail "cannot resolve HEAD"
  [ "$stage_sha" = "$head_sha" ] || _fail "HEAD moved before stage '$s' — rerun local CI"
  if [ "$NO_SIGNOFF" = 0 ] && [ -n "$stage_status" ]; then
    _fail "working tree changed before stage '$s' — refusing to attest"
  fi
  _log "stage: $s"
  # Run the stage in a subshell with errexit, OUTSIDE any condition context:
  # inside `if ! ( … )` or `( … ) || …` bash suppresses errexit, so a command
  # failing mid-stage would be masked and the stage reported green.
  set +e
  ( set -e; "stage_$s" )
  rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    _post_failure "$s" "$head_sha" "$s failed locally"
    _fail "stage '$s' failed"
  fi
  # A commit or an edit during the stage changes what was tested while
  # $head_sha stays the same, so refuse to attest. A dirty tree is only allowed
  # with --no-signoff; a moved HEAD is never allowed.
  post_status="$(_worktree_status)" \
    || _fail "git status failed — cannot verify tree cleanliness"
  post_sha="$(git rev-parse --verify HEAD)" || _fail "cannot resolve HEAD"
  if [ "$post_sha" != "$head_sha" ] \
     || { [ "$NO_SIGNOFF" = 0 ] && [ -n "$post_status" ]; }; then
    _post_failure "$s" "$head_sha" "$s ran while HEAD moved or tree changed"
    _fail "HEAD moved or working tree changed during stage '$s' — aborting instead of attesting untested code"
  fi
  _ok "$s passed"
  _post_success "$s" "$head_sha"
done

# A status that could not be posted is as bad as a failing stage: the commit is
# left without the record the run was for.
if [ "$signoff_failed" -ne 0 ]; then
  _fail "one or more signoff statuses could not be posted"
fi

if [ "$NO_SIGNOFF" = 1 ]; then
  _log "all done — no signoff statuses posted (was --no-signoff)."
else
  _log "all done."
fi

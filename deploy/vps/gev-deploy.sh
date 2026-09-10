#!/usr/bin/env bash
#
# God's Eye View — VPS deploy agent.
#
# Runs on a timer, decides which ref should be on the staging URL, and
# rebuilds only when that ref's commit changed. The default target is "auto":
# the most recently updated OPEN pull request, falling back to main when there
# is none — so opening a PR is all it takes for the staging URL to show it.
#
#   echo auto           > /opt/gev/target   # newest open PR, else main
#   echo main           > /opt/gev/target   # pin to main
#   echo my-branch      > /opt/gev/target   # pin to a branch
#
# WHAT IS SERVED ALWAYS CONTAINS MAIN (since 2026-09-10). "Newest open PR" on
# its own says nothing about merged work: a branch cut before two PRs landed
# keeps serving the tree it was cut from, so the URL shows a fork that is HOURS
# behind its own main and nothing on the box says why. Measured that day — PR
# #155, cut at #152, held #153 and #154 off the URL twenty minutes after they
# were merged. So `auto` now takes the newest open PR only while that branch is
# not behind main, and shows main itself otherwise. A preview is a superset of
# main or it is not shown; the reason is written to state/selection either way.
#
# An explicit pin is an explicit choice and is never overridden — but a pinned
# branch that has fallen behind main says so in the log and in state/selection,
# because "staging is pinned to something stale" is the other way this URL has
# lied about the repository.
#
# Deliberately pull-based: GitHub never needs a route into the VPS, and the
# box holds no CI credentials. The repo is public, so no token either.
#
# That last property is why the source arrives as a TARBALL rather than a
# clone. GitHub answers this box's anonymous ref advertisement (a GET) with
# 200 but returns 401 to POST /git-upload-pack, and every pack transfer goes
# through that POST — so `git clone` and `git fetch` cannot run here at all,
# under any protocol version. codeload is a plain GET and needs no credential.
# Listing a ref still works over git, but only in protocol v0, which does not
# POST; the v2 default cannot even resolve a branch head from this IP.
set -euo pipefail

ROOT=${GEV_ROOT:-/opt/gev}
REPO=${GEV_REPO:-mml-studio/gods-eye-view}
SRC="$ROOT/src"
STATE="$ROOT/state"
LOG() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

mkdir -p "$STATE"

# One deploy at a time: a build outlasts the timer interval.
exec 9>"$STATE/lock"
if ! flock -n 9; then
  LOG "another deploy holds the lock — skipping"
  exit 0
fi

# One listing, several refs: this is the git protocol, not the REST API, so it
# does not spend the anonymous 60/h quota this IP shares with its neighbours.
heads() {
  local refs=()
  local name
  for name in "$@"; do refs+=("refs/heads/$name"); done
  git -c protocol.version=0 ls-remote "https://github.com/$REPO.git" "${refs[@]}" 2>/dev/null || true
}
head_sha() { printf '%s\n' "$1" | awk -v r="refs/heads/$2" '$2 == r { print $1; exit }'; }

# How many commits of main are missing from $1, or "" when GitHub does not say.
#
# The answer is cached against the exact pair of shas it was computed for, so
# the REST call happens once per push rather than once per three-minute tick:
# an unchanged pair is the steady state and must cost nothing.
behind_main() {
  local head=$1 base=$2 cached_head cached_base cached_behind body behind
  if [ -f "$STATE/freshness" ]; then
    read -r cached_head cached_base cached_behind < "$STATE/freshness" || true
    if [ "${cached_head:-}" = "$head" ] && [ "${cached_base:-}" = "$base" ]; then
      printf '%s' "${cached_behind:-}"
      return 0
    fi
  fi
  body=$(curl -fsS --max-time 20 \
    -H 'Accept: application/vnd.github+json' \
    "https://api.github.com/repos/$REPO/compare/$base...$head" 2>/dev/null || true)
  behind=$(printf '%s' "$body" | jq -r 'if type == "object" then (.behind_by // empty) else empty end' 2>/dev/null || true)
  case "$behind" in
    '' | *[!0-9]*) return 0 ;;
  esac
  printf '%s %s %s\n' "$head" "$base" "$behind" > "$STATE/freshness"
  printf '%s' "$behind"
}

# One line, rewritten every tick: what was chosen, and why it was not the other
# thing. `cat /opt/gev/state/selection` has to answer "why am I looking at
# this?" without reading a journal.
note() {
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" > "$STATE/selection"
}

target=$(tr -d '[:space:]' < "$ROOT/target" 2>/dev/null || true)
target=${target:-auto}

branch=""
sha=""
if [ "$target" = auto ]; then
  # Newest open PR is the candidate; whether it gets the URL is decided below.
  # Not knowing whether a pull request EXISTS is different from not knowing
  # whether one is fresh: an outage here says nothing about what is deployed,
  # so it holds, while an unmeasurable candidate resolves to main.
  api=$(curl -fsS --max-time 20 \
    -H 'Accept: application/vnd.github+json' \
    "https://api.github.com/repos/$REPO/pulls?state=open&sort=updated&direction=desc&per_page=1" 2>/dev/null || true)
  if [ -z "$api" ]; then
    LOG "GitHub API unreachable — holding the current deployment"
    exit 0
  fi
  pr_branch=$(printf '%s' "$api" | jq -r 'if type == "array" then (.[0].head.ref // empty) else empty end')
  pr_number=$(printf '%s' "$api" | jq -r 'if type == "array" then (.[0].number // empty) else empty end')
  [ "$pr_branch" != null ] || pr_branch=""

  if [ -z "$pr_branch" ] || [ "$pr_branch" = main ]; then
    branch=main
    note "auto -> main (no open pull request)"
  else
    listing=$(heads main "$pr_branch")
    main_sha=$(head_sha "$listing" main)
    pr_sha=$(head_sha "$listing" "$pr_branch")
    label="PR #${pr_number:-?} $pr_branch"
    if [ -z "$main_sha" ]; then
      LOG "main has no commit on the remote — holding"
      exit 0
    elif [ -z "$pr_sha" ]; then
      # A branch deleted mid-flight, or a pull request opened from a fork:
      # either way this repository has no such head, and main is the honest
      # answer. Holding here would freeze the URL on whatever preceded it.
      branch=main
      sha="$main_sha"
      LOG "$label has no branch in this repository — showing main instead"
      note "auto -> main@$main_sha ($label has no branch here)"
    else
      behind=$(behind_main "$pr_sha" "$main_sha")
      if [ -z "$behind" ]; then
        # GitHub would not say whether the preview contains main. Unknown is
        # not "fine": main is the ref that cannot be missing merged work.
        branch=main
        sha="$main_sha"
        LOG "cannot tell whether $label contains main — showing main instead"
        note "auto -> main@$main_sha (freshness of $label unknown)"
      elif [ "$behind" -gt 0 ]; then
        branch=main
        sha="$main_sha"
        LOG "$label is $behind commit(s) behind main — showing main instead. Rebase the branch to preview it."
        note "auto -> main@$main_sha ($label is $behind commit(s) behind main)"
      else
        branch="$pr_branch"
        sha="$pr_sha"
        note "auto -> $pr_branch@$pr_sha ($label, up to date with main)"
      fi
    fi
  fi
else
  branch="$target"
  if [ "$branch" = main ]; then
    note "pinned -> main"
  else
    listing=$(heads main "$branch")
    main_sha=$(head_sha "$listing" main)
    sha=$(head_sha "$listing" "$branch")
    behind=""
    if [ -n "$main_sha" ] && [ -n "$sha" ]; then
      behind=$(behind_main "$sha" "$main_sha")
    fi
    # A pin is an explicit choice and outranks the invariant — but a stale one
    # is the reason someone stares at a URL that contradicts the repository,
    # so it is stated rather than left to be discovered.
    if [ -n "$behind" ] && [ "$behind" -gt 0 ]; then
      LOG "WARNING: staging is pinned to '$branch', which is $behind commit(s) behind main — merged work is NOT on the URL. 'echo auto > $ROOT/target' releases it."
      note "pinned -> $branch@$sha ($behind commit(s) behind main)"
    else
      note "pinned -> $branch${sha:+@$sha}"
    fi
  fi
fi

# `|| true` so an unreadable answer reaches the hold below rather than killing
# the script through `set -e` — holding is what the next line means to do, and
# without this it never got the chance to say so.
if [ -z "$sha" ]; then
  sha=$(git -c protocol.version=0 ls-remote "https://github.com/$REPO.git" \
        "refs/heads/$branch" 2>/dev/null | cut -f1 || true)
fi
if [ -z "$sha" ]; then
  LOG "branch '$branch' has no commit on the remote — holding"
  exit 0
fi

want="$branch@$sha"
have=$(cat "$STATE/deployed" 2>/dev/null || true)
running=$(docker inspect -f '{{.State.Running}}' gev 2>/dev/null || echo false)
if [ "$want" = "$have" ] && [ "$running" = true ]; then
  exit 0
fi

LOG "deploying $want (was ${have:-nothing}, container running=$running)"

# Unpack beside $SRC — same filesystem, so the swap below is a rename — and
# clean up on every exit path, including the refusal.
tmp=$(mktemp -d "$ROOT/unpack.XXXXXX")
trap 'rm -rf "$tmp"' EXIT

# A download that fails HOLDS rather than failing the unit: a flaky minute on
# codeload is not a reason to page, and the previous container keeps serving.
if ! curl -fsSL --max-time 300 -o "$tmp/src.tar.gz" \
     "https://codeload.github.com/$REPO/tar.gz/$sha"; then
  LOG "tarball for $want could not be downloaded — holding"
  exit 0
fi
mkdir -p "$tmp/tree"
if ! tar -xzf "$tmp/src.tar.gz" -C "$tmp/tree" --strip-components=1; then
  LOG "tarball for $want is unreadable — holding"
  exit 0
fi

# The gate lives in the ref, not on the box: a branch cut before it was added
# ignores GEV_ACCESS_PASSWORD entirely and would put an OPEN origin — every
# keyed proxy included — on a URL that is reachable. Read on the UNPACKED tree,
# before it replaces the live one, so a refusal leaves both the previous
# checkout and the previous container exactly as they were.
if grep -q '^GEV_ACCESS_PASSWORD=.' "$ROOT/.env" 2>/dev/null \
   && ! grep -qF 'gev-access-gate' "$tmp/tree/vite.config.js"; then
  LOG "REFUSING $want: this ref predates the access gate, so staging would be open. Rebase the branch onto main."
  exit 1
fi

rm -rf "$SRC"
mv "$tmp/tree" "$SRC"

cd "$ROOT"
if ! docker compose up -d --build; then
  LOG "build/start FAILED for $want — previous container left as-is"
  exit 1
fi

printf '%s' "$want" > "$STATE/deployed"
printf '%s\n' "$want deployed at $(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$STATE/status"
docker image prune -f --filter 'until=168h' >/dev/null 2>&1 || true
LOG "deployed $want"

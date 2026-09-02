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
REPO=${GEV_REPO:-Enerlens/gods-eye-view}
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

target=$(tr -d '[:space:]' < "$ROOT/target" 2>/dev/null || true)
target=${target:-auto}

branch=""
if [ "$target" = auto ]; then
  # Newest open PR wins. A GitHub outage or rate limit must not roll staging
  # back to main, so an unreadable answer keeps whatever is already deployed.
  api=$(curl -fsS --max-time 20 \
    -H 'Accept: application/vnd.github+json' \
    "https://api.github.com/repos/$REPO/pulls?state=open&sort=updated&direction=desc&per_page=1" 2>/dev/null || true)
  if [ -n "$api" ]; then
    branch=$(printf '%s' "$api" | jq -r 'if type == "array" then (.[0].head.ref // "main") else "" end')
  else
    LOG "GitHub API unreachable — holding the current deployment"
    exit 0
  fi
  [ -n "$branch" ] && [ "$branch" != null ] || branch=main
else
  branch="$target"
fi

# `|| true` so an unreadable answer reaches the hold below rather than killing
# the script through `set -e` — holding is what the next line means to do, and
# without this it never got the chance to say so.
sha=$(git -c protocol.version=0 ls-remote "https://github.com/$REPO.git" \
      "refs/heads/$branch" 2>/dev/null | cut -f1 || true)
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

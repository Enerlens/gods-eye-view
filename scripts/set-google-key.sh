#!/usr/bin/env bash
#
# God's Eye View — paste a Google Maps API key, prove it, then install it.
#
# WHY THIS EXISTS. A Google key is needed in more than one place and none of
# them announce that they are stale: a workspace with an old key does not fail,
# it renders a plausible half-empty globe. The three places are
#
#   1. the SEED .env at the repository root — every NEW Conductor workspace is
#      copied from it, so a key that is only in a workspace dies with it;
#   2. this checkout's own .env — what `npm run dev` reads right now;
#   3. /opt/gev/.env on the staging box — inlined into the bundle at BUILD
#      time (the `define` block in vite.config.js), so staging must rebuild.
#
# And a key can be wrong in four different ways that look identical from the
# app (a greyed-out "Google 3D" chip): invalid, billing disabled, restricted to
# referrers this origin is not in, or regionally withheld. So the key is probed
# against Google BEFORE it is written anywhere, and the probe prints which of
# the four it is — `roadmap` is the control that separates "your account is
# fine, your region is not" from "your billing is dead".
#
# Usage
#   scripts/set-google-key.sh                 # prompt, probe, then ask per target
#   scripts/set-google-key.sh AIza…           # same, key given on the command line
#   scripts/set-google-key.sh --check         # probe only, write nothing
#   scripts/set-google-key.sh --yes           # no prompts: seed + this checkout
#   scripts/set-google-key.sh --yes --vps     # …and rebuild staging
#   echo AIza… | scripts/set-google-key.sh -y # piped
#
# Nothing here ever prints the key in full, and every file it rewrites is
# backed up next to itself first.
set -euo pipefail

SEED_ENV="${GEV_SEED_ENV:-$HOME/conductor/repos/gods-eye-view/.env}"
WORKSPACES_DIR="${GEV_WORKSPACES_DIR:-$HOME/conductor/workspaces/gods-eye-view}"
VPS_HOST="${GEV_VPS_HOST:-vps}"
VPS_ROOT="${GEV_VPS_ROOT:-/opt/gev}"
# Probes carry a Referer because SECURITY.md tells you to restrict the key by
# HTTP referrer — without one, a correctly restricted key looks broken here.
PROBE_REFERER="${GEV_PROBE_REFERER:-https://gev.enerlens.com/}"
VAR=GOOGLE_MAPS_API_KEY

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL_ENV="$ROOT_DIR/.env"
STAMP="$(date +%Y%m%d-%H%M%S)"

KEY=""
CHECK_ONLY=0
ASSUME_YES=0
WANT_VPS=""
WANT_WORKSPACES=""

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
dim()  { printf '\033[2m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }

# The header comment IS the help text, down to the first line that is not a
# comment — so a hard-coded line range cannot go stale and truncate it.
usage() { awk 'NR>2 && /^#/ { sub(/^# ?/, ""); print; next } NR>2 { exit }' "${BASH_SOURCE[0]}"; exit 0; }

while [ $# -gt 0 ]; do
  case "$1" in
    -c|--check)          CHECK_ONLY=1 ;;
    -y|--yes)            ASSUME_YES=1 ;;
    --vps)               WANT_VPS=1 ;;
    --no-vps)            WANT_VPS=0 ;;
    --all-workspaces)    WANT_WORKSPACES=1 ;;
    --no-workspaces)     WANT_WORKSPACES=0 ;;
    -h|--help)           usage ;;
    AIza*)               KEY="$1" ;;
    *) echo "unknown argument: $1 (try --help)" >&2; exit 2 ;;
  esac
  shift
done

# ── 1. get the key ───────────────────────────────────────────────────────────
if [ -z "$KEY" ]; then
  if [ -t 0 ]; then
    # Hidden input: the key would otherwise sit in the scrollback and in the
    # shell history of anyone who later scrolls up. A truncated paste is caught
    # by the format check below, so hiding it costs no safety.
    printf 'Paste the Google Maps API key (input hidden), then Enter: '
    read -rs KEY
    printf '\n'
  else
    read -r KEY
  fi
fi
KEY="$(printf '%s' "$KEY" | tr -d '[:space:]')"

if ! printf '%s' "$KEY" | grep -qE '^AIza[0-9A-Za-z_-]{35}$'; then
  bad "That is not a Google API key: expected AIza + 35 chars (39 total), got ${#KEY} chars."
  dim  "A short count almost always means the paste was truncated — copy it again from the Cloud Console."
  exit 1
fi

MASKED="${KEY:0:10}…${KEY: -4}"
bold "Key ${MASKED} — 39 chars, well-formed."

# ── 2. probe it against Google ───────────────────────────────────────────────
# Each probe leaves its HTTP code in <name>_CODE and Google's own explanation
# in <name>_MSG, so the verdict below reads the same facts the app would hit.
probe() {
  local out code body
  out="$(mktemp)"
  code="$(curl -s -o "$out" -w '%{http_code}' --max-time 20 -H "Referer: $PROBE_REFERER" "$@" || echo 000)"
  body="$(tr -d '\n' < "$out")"
  rm -f "$out"
  PROBE_CODE="$code"
  PROBE_MSG="$(printf '%s' "$body" | sed -nE 's/.*"(error_message|message)"[[:space:]]*:[[:space:]]*"([^"]*)".*/\2/p' | head -1)"
  PROBE_STATUS="$(printf '%s' "$body" | sed -nE 's/.*"status"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/p' | head -1)"
}

session_probe() {
  probe -X POST -H 'Content-Type: application/json' \
    -d "{\"mapType\":\"$1\",\"language\":\"en-US\",\"region\":\"US\"}" \
    "https://tile.googleapis.com/v1/createSession?key=$KEY"
}

row() { # name, code, pass(0|1), note
  local mark='✗' colour='31'
  [ "$3" = 1 ] && { mark='✓'; colour='32'; }
  printf '  \033[%sm%s\033[0m %-12s %-4s %s\n' "$colour" "$mark" "$1" "$2" "${4:-}"
}

echo
bold "Probing Google — at most 20 s per call, Referer: $PROBE_REFERER"

probe "https://tile.googleapis.com/v1/3dtiles/root.json?key=$KEY"
TILES_CODE="$PROBE_CODE"; TILES_MSG="$PROBE_MSG"
row "3D Tiles" "$TILES_CODE" "$([ "$TILES_CODE" = 200 ] && echo 1 || echo 0)" "$TILES_MSG"

session_probe satellite
SAT_CODE="$PROBE_CODE"; SAT_MSG="$PROBE_MSG"
row "Satellite" "$SAT_CODE" "$([ "$SAT_CODE" = 200 ] && echo 1 || echo 0)" "$SAT_MSG"

session_probe roadmap
ROAD_CODE="$PROBE_CODE"; ROAD_MSG="$PROBE_MSG"
row "Roadmap" "$ROAD_CODE" "$([ "$ROAD_CODE" = 200 ] && echo 1 || echo 0)" "${ROAD_MSG:-the control: proves billing + API enablement}"

probe "https://maps.googleapis.com/maps/api/geocode/json?address=Paris&key=$KEY"
GEO_CODE="$PROBE_CODE"; GEO_STATUS="$PROBE_STATUS"; GEO_MSG="$PROBE_MSG"
row "Geocoding" "$GEO_CODE" "$([ "$GEO_STATUS" = OK ] && echo 1 || echo 0)" "${GEO_STATUS:-no answer} ${GEO_MSG:-}"

# ── 3. verdict ───────────────────────────────────────────────────────────────
echo
TILES_OK=0
if [ "$TILES_CODE" = 200 ]; then
  TILES_OK=1
  bold "Verdict — this key serves Photorealistic 3D Tiles. 🎉"
  dim  "Install it and the globe comes back: the map-stack chip 'Google 3D' becomes selectable."
elif [ "$TILES_CODE" = 403 ] && [ "$ROAD_CODE" = 200 ]; then
  bold "Verdict — the key is VALID and BILLED, but Google withholds 3D + satellite for this account's region."
  dim  "That is the EEA withdrawal (developers.google.com/maps/comms/eea/map-tiles); it is keyed on the"
  dim  "BILLING ADDRESS, not on the key. Roadmap answering 200 is what rules out billing and enablement."
  dim  "Installing it still buys you geocoding, place search and the cockpit place readout — not the 3D globe."
elif printf '%s' "$TILES_MSG $GEO_MSG" | grep -qi 'referer\|referrer'; then
  bold "Verdict — the key is REFERRER-RESTRICTED and $PROBE_REFERER is not on its allowlist."
  dim  "Add it in the Cloud Console (or re-run with GEV_PROBE_REFERER=… to probe as another origin)."
elif [ "$ROAD_CODE" != 200 ]; then
  bold "Verdict — nothing works with this key, not even roadmap."
  dim  "Almost always billing: an unpaid prepayment leaves the project linked to a CLOSED billing account,"
  dim  "and every Maps endpoint then answers 404 NOT_FOUND / 403. Check console.cloud.google.com/billing."
else
  bold "Verdict — mixed result, read the rows above."
fi

if [ "$CHECK_ONLY" = 1 ]; then
  echo; dim "--check: nothing was written."
  exit 0
fi

if [ "$TILES_OK" = 0 ] && [ "$ASSUME_YES" = 0 ]; then
  echo
  read -r -p "3D Tiles do NOT work with this key. Install it anyway? [y/N] " reply
  case "$reply" in [yY]*) ;; *) echo "Nothing written."; exit 0 ;; esac
fi

# ── 4. install ───────────────────────────────────────────────────────────────
# awk, not sed -i: the value can contain characters sed would treat as
# delimiters, and macOS sed -i needs an argument BSD/GNU disagree about.
# An existing assignment is replaced in place (order preserved); a file that
# never had the variable gets it appended.
put_env_var() {
  local file="$1" tmp
  tmp="$(mktemp)"
  if [ -f "$file" ]; then
    cp -p "$file" "$file.bak-$STAMP"
    chmod 600 "$file.bak-$STAMP" 2>/dev/null || true
    NAME="$VAR" VALUE="$KEY" awk '
      BEGIN { name = ENVIRON["NAME"]; value = ENVIRON["VALUE"]; done = 0 }
      !done && index($0, name "=") == 1 { print name "=" value; done = 1; next }
      { print }
      END { if (!done) print name "=" value }
    ' "$file" > "$tmp"
  else
    printf '%s=%s\n' "$VAR" "$KEY" > "$tmp"
  fi
  mv "$tmp" "$file"
  chmod 600 "$file"
}

confirm() { # question, default(y/n)
  [ "$ASSUME_YES" = 1 ] && return 0
  local reply
  read -r -p "$1 [${2}] " reply
  reply="${reply:-$2}"
  case "$reply" in [yY]*) return 0 ;; *) return 1 ;; esac
}

echo
bold "Installing"

# 4a. the seed .env — the only copy new workspaces inherit.
if [ -f "$SEED_ENV" ] || [ -d "$(dirname "$SEED_ENV")" ]; then
  if confirm "  Write the seed $SEED_ENV (every NEW workspace inherits it)?" y; then
    put_env_var "$SEED_ENV"
    ok "seed updated — backup at $(basename "$SEED_ENV").bak-$STAMP"
  else
    warn "seed left alone — a key only in a workspace dies with that workspace"
  fi
else
  dim "  (no seed .env at $SEED_ENV — skipped)"
fi

# 4b. this checkout.
if [ "$LOCAL_ENV" != "$SEED_ENV" ]; then
  if confirm "  Write this checkout's $(basename "$ROOT_DIR")/.env (what npm run dev reads)?" y; then
    put_env_var "$LOCAL_ENV"
    ok "this checkout updated — restart npm run dev to pick it up"
  fi
fi

# 4c. the other existing workspaces. Conductor copies .env at CREATION time
# only, so every workspace already on disk still holds the old key.
if [ -d "$WORKSPACES_DIR" ]; then
  others=()
  while IFS= read -r env_file; do
    [ "$env_file" = "$LOCAL_ENV" ] && continue
    others+=("$env_file")
  done < <(find "$WORKSPACES_DIR" -mindepth 2 -maxdepth 2 -name .env -type f 2>/dev/null | sort)
  if [ "${#others[@]}" -gt 0 ]; then
    do_others=0
    if [ "$WANT_WORKSPACES" = 1 ]; then do_others=1
    elif [ "$WANT_WORKSPACES" = 0 ]; then do_others=0
    elif confirm "  Also update the ${#others[@]} other existing workspaces?" n; then do_others=1
    fi
    if [ "$do_others" = 1 ]; then
      for env_file in "${others[@]}"; do put_env_var "$env_file"; done
      ok "${#others[@]} workspaces updated"
    else
      dim "  ${#others[@]} other workspaces keep the old key (they are copies, not links)"
    fi
  fi
fi

# 4d. staging. The key is INLINED AT BUILD TIME, so writing .env is only half
# of it — the image has to be rebuilt. Clearing state/deployed is what makes
# the deploy agent rebuild a ref it already considers deployed; going through
# the agent (rather than `docker compose` by hand) keeps its lock and its
# refuse-an-open-ref check in play.
do_vps=0
if [ "$WANT_VPS" = 1 ]; then do_vps=1
elif [ "$WANT_VPS" = 0 ]; then do_vps=0
elif confirm "  Push to staging $VPS_HOST:$VPS_ROOT/.env and rebuild (~3 min, gev.enerlens.com)?" n; then do_vps=1
fi

if [ "$do_vps" = 1 ]; then
  # The key travels inside the script on stdin, never in argv — it would
  # otherwise be readable in `ps` on the remote box for the life of the call.
  if ssh -T "$VPS_HOST" bash -s <<REMOTE
set -euo pipefail
cd "$VPS_ROOT"
cp -p .env ".env.bak-$STAMP" && chmod 600 ".env.bak-$STAMP"
NAME='$VAR' VALUE='$KEY' awk '
  BEGIN { name = ENVIRON["NAME"]; value = ENVIRON["VALUE"]; done = 0 }
  !done && index(\$0, name "=") == 1 { print name "=" value; done = 1; next }
  { print }
  END { if (!done) print name "=" value }
' .env > .env.new
mv .env.new .env && chmod 600 .env
# Same branch@sha as before, so only a cleared marker makes the agent rebuild.
rm -f state/deployed
systemctl start gev-deploy.service
REMOTE
  then
    ok "staging .env updated and a rebuild started"
    dim "  follow it:  ssh $VPS_HOST 'journalctl -u gev-deploy -f'"
    dim "  then check: node scripts/qa-deployment.mjs --url https://gev.enerlens.com/ --auth gev:<password>"
  else
    bad "staging update failed — the previous container is still serving"
  fi
fi

echo
bold "Done — key ${MASKED} installed."
[ "$TILES_OK" = 1 ] && dim "Reload the app: 'Google 3D' should now be selectable in the map-stack row."

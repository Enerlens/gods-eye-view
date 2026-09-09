#!/usr/bin/env bash
#
# God's Eye View — paste an OpenAI API key, prove it, then install it.
#
# WHY THIS EXISTS. Two reasons, and the second is the one that bites.
#
#   1. The key is needed in more than one place and none of them announce that
#      they are missing: the SEED .env at the repository root (every NEW
#      Conductor workspace is copied from it, so a key that is only in a
#      workspace dies with it), this checkout's own .env (what `npm run dev`
#      reads), the other workspaces already on disk (copies, not links), and
#      /opt/gev/.env on the staging box.
#
#   2. On THIS fork, OPENAI_API_KEY alone changes nothing. Our .env pins
#      GEV_VOICE_PROVIDER=openrouter, and resolveVoiceProvider() honours a
#      NAMED provider over a present key on purpose — "a typo in .env must not
#      quietly bill a different account than the one the operator named"
#      (src/voice/voiceProviderPolicy.js). A key installed without flipping the
#      provider leaves the mic on Mistral and you hear no difference at all.
#      This script flips it, per file, and says so.
#
# And a key can be wrong in four ways that look identical from the app (a mic
# that just says voice is unavailable): revoked, out of credit, scoped to a
# project without model access, or perfectly fine but pointed at a model id
# that has drifted. So the key is probed BEFORE it is written anywhere, against
# the exact endpoint the app uses — POST /v1/realtime/client_secrets, which
# MINTS an ephemeral secret and starts no session, so those probes cost $0.
# One optional probe does spend: a 16-token /v1/responses call, about $0.00001,
# which is the control that separates "your account is dead" from "realtime in
# particular is not available to you". Skip it with --no-spend.
#
# SECURITY. The key is read with echo off, so it never lands in the scrollback
# or in your shell history. It is never printed in full, never passed in argv
# (curl reads its config from stdin, ssh reads its script from stdin — argv is
# world-readable in `ps`), and every file written is chmod 600, backed up next
# to itself first, at .env.bak-<stamp>, which .gitignore already covers. The
# script refuses to write a .env that git would track.
#
# Usage
#   scripts/set-openai-key.sh                  # prompt, probe, then ask per target
#   scripts/set-openai-key.sh --check          # probe only, write nothing (exit 0 = mic works)
#   scripts/set-openai-key.sh --yes            # no prompts: seed + this checkout
#   scripts/set-openai-key.sh --yes --all-workspaces
#   scripts/set-openai-key.sh --yes --vps      # …and staging (public! see below)
#   scripts/set-openai-key.sh --provider auto  # or: openai (default), keep
#   scripts/set-openai-key.sh --no-spend       # free probes only
#   echo sk-proj-… | scripts/set-openai-key.sh -y
#
# Passing the key as an argument works but puts it in your shell history; the
# prompt does not. Prefer the prompt.
set -euo pipefail

SEED_ENV="${GEV_SEED_ENV:-$HOME/conductor/repos/gods-eye-view/.env}"
WORKSPACES_DIR="${GEV_WORKSPACES_DIR:-$HOME/conductor/workspaces/gods-eye-view}"
VPS_HOST="${GEV_VPS_HOST:-vps}"
VPS_ROOT="${GEV_VPS_ROOT:-/opt/gev}"
TIMEOUT="${GEV_PROBE_TIMEOUT:-25}"
VAR=OPENAI_API_KEY

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL_ENV="$ROOT_DIR/.env"
STAMP="$(date +%Y%m%d-%H%M%S)"

KEY=""
CHECK_ONLY=0
ASSUME_YES=0
WANT_VPS=""
WANT_WORKSPACES=""
PROVIDER_CHOICE=openai
SPEND_PROBE=1

TMPFILES=()
cleanup() { [ "${#TMPFILES[@]}" -gt 0 ] && rm -f "${TMPFILES[@]}" || true; }
trap cleanup EXIT
tmp600() { local f; f="$(mktemp)"; chmod 600 "$f"; TMPFILES+=("$f"); printf '%s' "$f"; }

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
    --no-spend)          SPEND_PROBE=0 ;;
    --provider)          shift; PROVIDER_CHOICE="${1:-}" ;;
    --provider=*)        PROVIDER_CHOICE="${1#*=}" ;;
    -h|--help)           usage ;;
    sk-*)                KEY="$1" ;;
    *) echo "unknown argument: $1 (try --help)" >&2; exit 2 ;;
  esac
  shift
done

case "$PROVIDER_CHOICE" in
  openai|auto|keep) ;;
  *) echo "--provider must be openai, auto or keep (got: $PROVIDER_CHOICE)" >&2; exit 2 ;;
esac

# ── 1. get the key ───────────────────────────────────────────────────────────
if [ -z "$KEY" ]; then
  if [ -t 0 ]; then
    # Hidden input: the key would otherwise sit in the scrollback and in the
    # shell history of anyone who later scrolls up. A truncated paste is caught
    # by the format check below, so hiding it costs no safety.
    printf 'Paste the OpenAI API key (input hidden), then Enter: '
    read -rs KEY
    printf '\n'
  else
    read -r KEY
  fi
fi
# Tolerate the two shapes a paste actually arrives in: bare, or copied out of a
# .env line. Quotes and whitespace go; everything else is judged as-is.
KEY="$(printf '%s' "$KEY" | tr -d '[:space:]')"
KEY="${KEY#OPENAI_API_KEY=}"
KEY="${KEY#\"}"; KEY="${KEY%\"}"
KEY="${KEY#\'}"; KEY="${KEY%\'}"

case "$KEY" in
  sk-or-v1-*)
    bad "That is an OPENROUTER key (sk-or-v1-…), not an OpenAI one."
    dim  "This fork already has one in OPENROUTER_API_KEY — it is what the mic uses today."
    dim  "The OpenAI key is at platform.openai.com/api-keys and starts sk-proj- or sk-."
    exit 1 ;;
  sk-admin-*)
    bad "That is an OpenAI ADMIN key. Admin keys only reach /v1/organization/* — the mic cannot use one."
    dim  "Make a normal secret key at platform.openai.com/api-keys."
    exit 1 ;;
esac

if ! printf '%s' "$KEY" | grep -qE '^sk-[A-Za-z0-9_-]{20,}$' || [ "${#KEY}" -lt 40 ]; then
  bad "That does not look like an OpenAI secret key: expected sk-… of 40+ chars, got ${#KEY}."
  dim  "A short count almost always means the paste was truncated — copy it again from"
  dim  "platform.openai.com/api-keys (a key is shown in full exactly once, at creation)."
  exit 1
fi

MASKED="${KEY:0:10}…${KEY: -4}"
bold "Key ${MASKED} — ${#KEY} chars, well-formed."

# ── 2. which models the app will actually ask for ────────────────────────────
# Resolved the same way the server resolves them (vite.config.js): the .env
# override wins, else the constant in src/voice/voiceCost.js. Probing the
# RESOLVED id is what turns "the mic is dead" into "your override is stale".
dotenv() { node "$ROOT_DIR/scripts/read-dotenv-value.mjs" "$1" "${2:-$ROOT_DIR}" 2>/dev/null || true; }
model_default() {
  node --input-type=module -e \
    "import { VOICE_MODELS } from '$ROOT_DIR/src/voice/voiceCost.js'; process.stdout.write(VOICE_MODELS['$1'].id);" \
    2>/dev/null || true
}

MODEL_STD="$(dotenv OPENAI_REALTIME_MODEL)";      MODEL_STD="${MODEL_STD:-$(model_default standard)}"
MODEL_MINI="$(dotenv OPENAI_REALTIME_MODEL_MINI)"; MODEL_MINI="${MODEL_MINI:-$(model_default mini)}"
MODEL_HUD="$(dotenv OPENAI_HUD_SUMMARY_MODEL)";   MODEL_HUD="${MODEL_HUD:-gpt-5-nano}"
CURRENT_PROVIDER="$(dotenv GEV_VOICE_PROVIDER)"
VOICE_LANGUAGE="$(dotenv GEV_VOICE_LANGUAGE)"
: "${MODEL_STD:=gpt-realtime-2}" "${MODEL_MINI:=gpt-realtime-2.1-mini}"

# ── 3. probe it against OpenAI ───────────────────────────────────────────────
# The key travels to curl inside a config on STDIN, never in argv: argv is
# readable by any process on this machine via `ps`, a config on a pipe is not.
api() { # method url [body-json] -> PROBE_CODE / PROBE_MSG / PROBE_ERRCODE
  local method="$1" url="$2" body="${3:-}" out body_file=""
  out="$(tmp600)"
  # Both temp files are created HERE, not inside the subshell below: a mktemp
  # run in a subshell would never reach the cleanup trap's array.
  if [ -n "$body" ]; then body_file="$(tmp600)"; printf '%s' "$body" > "$body_file"; fi
  # The config block is the only thing on curl's stdin; curl's own stdout is
  # just %{http_code}, so it can be captured without swallowing the response.
  PROBE_CODE="$(
    {
      printf 'url = "%s"\n'  "$url"
      printf 'request = "%s"\n' "$method"
      printf 'header = "Authorization: Bearer %s"\n' "$KEY"
      printf 'header = "Content-Type: application/json"\n'
      [ -n "$body_file" ] && printf 'data = "@%s"\n' "$body_file"
      printf 'silent\n'
      printf 'max-time = "%s"\n' "$TIMEOUT"
      printf 'output = "%s"\n' "$out"
      printf 'write-out = "%%{http_code}"\n'
    } | curl -K - || echo 000
  )"
  PROBE_BODY="$(tr -d '\n' < "$out")"
  PROBE_MSG="$(printf '%s' "$PROBE_BODY" | sed -nE 's/.*"message"[[:space:]]*:[[:space:]]*"(([^"\\]|\\.)*)".*/\1/p' | head -1)"
  PROBE_ERRCODE="$(printf '%s' "$PROBE_BODY" | sed -nE 's/.*"code"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/p' | head -1)"
}

row() { # name, code, pass(0|1), note
  local mark='✗' colour='31' note="${4:-}"
  [ "$3" = 1 ] && { mark='✓'; colour='32'; }
  # OpenAI's messages run to 200 characters and would wrap the table into
  # unreadability; the full text is still in the verdict below when it matters.
  [ "${#note}" -gt 96 ] && note="${note:0:95}…"
  printf '  \033[%sm%s\033[0m %-18s %-4s %s\n' "$colour" "$mark" "$1" "$2" "$note"
}

echo
bold "Probing OpenAI — at most ${TIMEOUT}s per call"

# 3a. Is it a key at all? The cheapest possible call, and free.
api GET "https://api.openai.com/v1/models"
MODELS_CODE="$PROBE_CODE"; MODELS_MSG="$PROBE_MSG"; MODELS_ERR="$PROBE_ERRCODE"
row "key accepted" "$MODELS_CODE" "$([ "$MODELS_CODE" = 200 ] && echo 1 || echo 0)" \
  "${MODELS_MSG:-GET /v1/models}"

# 3b. The mic itself. This is the exact call /api/realtime/token makes
# (vite.config.js), minus the 28 tool schemas — it MINTS a client secret and
# starts no session, so it is free however many times you run it.
realtime_probe() {
  api POST "https://api.openai.com/v1/realtime/client_secrets" \
    "{\"session\":{\"type\":\"realtime\",\"model\":\"$1\"}}"
}

realtime_probe "$MODEL_STD"
STD_CODE="$PROBE_CODE"; STD_MSG="$PROBE_MSG"; STD_ERR="$PROBE_ERRCODE"
row "realtime standard" "$STD_CODE" "$([ "$STD_CODE" = 200 ] && echo 1 || echo 0)" \
  "$MODEL_STD ${STD_MSG:-}"

realtime_probe "$MODEL_MINI"
MINI_CODE="$PROBE_CODE"; MINI_MSG="$PROBE_MSG"
row "realtime mini" "$MINI_CODE" "$([ "$MINI_CODE" = 200 ] && echo 1 || echo 0)" \
  "$MODEL_MINI ${MINI_MSG:-}"

# 3c. The control. Minting a secret does not prove the account can be BILLED,
# so one real 16-token completion answers the question the mic cannot: is
# there credit on this account, or is realtime specifically withheld? Costs
# about $0.00001 on gpt-5-nano. --no-spend skips it and loses that distinction.
HUD_CODE=""; HUD_MSG=""; HUD_ERR=""
if [ "$SPEND_PROBE" = 1 ]; then
  api POST "https://api.openai.com/v1/responses" \
    "{\"model\":\"$MODEL_HUD\",\"input\":\"ping\",\"max_output_tokens\":16}"
  HUD_CODE="$PROBE_CODE"; HUD_MSG="$PROBE_MSG"; HUD_ERR="$PROBE_ERRCODE"
  row "billing control" "$HUD_CODE" "$([ "$HUD_CODE" = 200 ] && echo 1 || echo 0)" \
    "$MODEL_HUD — the HUD summary, ~\$0.00001 ${HUD_MSG:-}"
else
  dim "  · billing control        skipped (--no-spend): a 429 below cannot be read as 'no credit'"
fi

# ── 4. verdict ───────────────────────────────────────────────────────────────
echo
MIC_OK=0
ALL_ERR="$STD_ERR $HUD_ERR $MODELS_ERR"
ALL_MSG="$MODELS_MSG $STD_MSG $MINI_MSG $HUD_MSG"
if [ "$STD_CODE" = 200 ]; then
  MIC_OK=1
  bold "Verdict — this key drives the Realtime mic. 🎉"
  dim  "Both tiers answered, so the model ids in .env are current and the account is cleared for realtime."
elif printf '%s' "$ALL_ERR" | grep -q 'insufficient_quota'; then
  bold "Verdict — the key is VALID but the account has NO CREDIT."
  dim  "OpenAI's API is prepaid and separate from a ChatGPT Plus subscription: a Plus plan buys you"
  dim  "nothing here. Add \$5 at platform.openai.com/settings/organization/billing/overview and re-run."
elif [ "$MODELS_CODE" = 401 ] || printf '%s' "$ALL_ERR" | grep -q 'invalid_api_key'; then
  bold "Verdict — OpenAI does not recognise this key."
  dim  "Either it was revoked, or the paste is not the whole key. A key is shown in full exactly once,"
  dim  "at creation — if you cannot see it again at platform.openai.com/api-keys, make a new one."
elif printf '%s' "$ALL_ERR" | grep -qi 'model_not_found' || [ "$STD_CODE" = 404 ]; then
  bold "Verdict — the key works, but '$MODEL_STD' is not a model this account can open."
  dim  "Two causes, and neither is a code change: the id has moved (override it with"
  dim  "OPENAI_REALTIME_MODEL= in .env, see .env.example), or the org is not verified for realtime"
  dim  "(platform.openai.com/settings/organization/general). Mini answered ${MINI_CODE} — if that is 200,"
  dim  "install this key and start the mic on the mini tier."
elif printf '%s' "$ALL_ERR $ALL_MSG" | grep -qi 'unsupported_country\|country, region\|territory'; then
  bold "Verdict — OpenAI is refusing this account's region."
  dim  "Nothing in .env fixes that; it is keyed on the account, not on the key."
elif printf '%s' "$ALL_ERR" | grep -qi 'insufficient_permissions\|mismatched\|invalid_organization'; then
  bold "Verdict — the key is real but SCOPED AWAY from what the mic needs."
  dim  "A project key can be restricted per endpoint. Give it model + realtime write access on its"
  dim  "project, or make an unrestricted key: platform.openai.com/api-keys."
elif [ "$HUD_CODE" = 200 ]; then
  bold "Verdict — the ACCOUNT is fine (the billing control passed) but realtime is not open to it."
  dim  "Read the realtime rows above; the HUD summary and any text feature will work either way."
else
  bold "Verdict — mixed result, read the rows above."
fi

if [ "$CHECK_ONLY" = 1 ]; then
  echo; dim "--check: nothing was written."
  # Exit status IS the answer, so --check can gate a script: 0 = the mic works.
  [ "$MIC_OK" = 1 ] && exit 0 || exit 1
fi

if [ "$MIC_OK" = 0 ] && [ "$ASSUME_YES" = 0 ]; then
  echo
  read -r -p "The Realtime mic does NOT work with this key. Install it anyway? [y/N] " reply
  case "$reply" in [yY]*) ;; *) echo "Nothing written."; exit 0 ;; esac
fi

# ── 5. install ───────────────────────────────────────────────────────────────
# awk, not sed -i: the value can contain characters sed would treat as
# delimiters, and macOS sed -i needs an argument BSD/GNU disagree about.
# An existing assignment is replaced in place (order preserved); a file that
# never had the variable gets it appended.
BACKED_UP=""
backup_once() {
  local file="$1"
  case " $BACKED_UP " in *" $file "*) return 0 ;; esac
  if [ -f "$file" ]; then
    cp -p "$file" "$file.bak-$STAMP"
    chmod 600 "$file.bak-$STAMP" 2>/dev/null || true
  fi
  BACKED_UP="$BACKED_UP $file"
}

put_env_var() { # file, NAME, VALUE
  local file="$1" name="$2" value="$3" tmp
  backup_once "$file"
  tmp="$(tmp600)"
  if [ -f "$file" ]; then
    NAME="$name" VALUE="$value" awk '
      BEGIN { name = ENVIRON["NAME"]; value = ENVIRON["VALUE"]; done = 0 }
      !done && index($0, name "=") == 1 { print name "=" value; done = 1; next }
      { print }
      END { if (!done) print name "=" value }
    ' "$file" > "$tmp"
  else
    printf '%s=%s\n' "$name" "$value" > "$tmp"
  fi
  cp "$tmp" "$file"
  chmod 600 "$file"
}

# A key must never become a tracked file. Every .env here is covered by
# .gitignore today; this refuses to be the run where that stops being true.
assert_ignored() {
  local file="$1" dir
  dir="$(dirname "$file")"
  git -C "$dir" rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 0
  if ! git -C "$dir" check-ignore -q "$file" 2>/dev/null; then
    bad "REFUSING $file — git does not ignore it, so writing the key there would stage a secret."
    return 1
  fi
  return 0
}

install_into() { # file, label
  local file="$1"
  assert_ignored "$file" || return 1
  put_env_var "$file" "$VAR" "$KEY"
  [ "$PROVIDER_CHOICE" != keep ] && put_env_var "$file" GEV_VOICE_PROVIDER "$PROVIDER_CHOICE"
  return 0
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
if [ "$PROVIDER_CHOICE" = keep ]; then
  warn "--provider keep: only $VAR is written."
  if [ "$CURRENT_PROVIDER" = openrouter ]; then
    warn "GEV_VOICE_PROVIDER=openrouter stays pinned here, so the mic will keep using Mistral and this key will NOT be billed."
  fi
else
  dim  "  Each file gets two lines: $VAR, and GEV_VOICE_PROVIDER=$PROVIDER_CHOICE."
  dim  "  Without the second one a key changes nothing — see the header of this script."
fi

# 5a. the seed .env — the only copy new workspaces inherit.
if [ -f "$SEED_ENV" ] || [ -d "$(dirname "$SEED_ENV")" ]; then
  if confirm "  Write the seed $SEED_ENV (every NEW workspace inherits it)?" y; then
    if install_into "$SEED_ENV"; then
      ok "seed updated — backup at $(basename "$SEED_ENV").bak-$STAMP"
    fi
  else
    warn "seed left alone — a key only in a workspace dies with that workspace"
  fi
else
  dim "  (no seed .env at $SEED_ENV — skipped)"
fi

# 5b. this checkout.
if [ "$LOCAL_ENV" != "$SEED_ENV" ]; then
  if confirm "  Write this checkout's $(basename "$ROOT_DIR")/.env (what npm run dev reads)?" y; then
    if install_into "$LOCAL_ENV"; then
      ok "this checkout updated — restart npm run dev to pick it up"
    fi
  fi
fi

# 5c. the other existing workspaces. Conductor copies .env at CREATION time
# only, so every workspace already on disk still holds the old value.
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
      for env_file in "${others[@]}"; do install_into "$env_file" || true; done
      ok "${#others[@]} workspaces updated"
    else
      dim "  ${#others[@]} other workspaces keep their old value (they are copies, not links)"
    fi
  fi
fi

# 5d. staging. Unlike the Google key, OPENAI_API_KEY is NOT inlined into the
# bundle (no VITE_ prefix, not a build ARG in the Dockerfile) — docker-compose
# passes /opt/gev/.env at RUNTIME, so `up -d` recreates the container in
# seconds and no rebuild is needed. state/deployed is left alone on purpose:
# the ref has not moved, and clearing it would trigger a 3-minute rebuild for
# nothing.
echo
do_vps=0
if [ "$WANT_VPS" = 1 ]; then do_vps=1
elif [ "$WANT_VPS" = 0 ]; then do_vps=0
else
  warn "Staging is REACHABLE FROM THE INTERNET (gev.enerlens.com). A key there means anyone"
  warn "past the Basic-auth prompt can open sessions on your credit — up to ~\$10/hour at the"
  warn "standard tier. Say no unless you want the hosted demo to talk."
  confirm "  Push to staging $VPS_HOST:$VPS_ROOT/.env and restart (~15 s)?" n && do_vps=1
fi

if [ "$do_vps" = 1 ]; then
  # The key travels inside the script on stdin, never in argv — it would
  # otherwise be readable in `ps` on the remote box for the life of the call.
  # A per-IP cap is armed at the same time if the box has none: on a public
  # host that cap is the only thing between a stuck client and the credit.
  if ssh -T "$VPS_HOST" bash -s <<REMOTE
set -euo pipefail
cd "$VPS_ROOT"
cp -p .env ".env.bak-$STAMP" && chmod 600 ".env.bak-$STAMP"
put() {
  NAME="\$1" VALUE="\$2" awk '
    BEGIN { name = ENVIRON["NAME"]; value = ENVIRON["VALUE"]; done = 0 }
    !done && index(\$0, name "=") == 1 { print name "=" value; done = 1; next }
    { print }
    END { if (!done) print name "=" value }
  ' .env > .env.new
  mv .env.new .env && chmod 600 .env
}
put '$VAR' '$KEY'
[ '$PROVIDER_CHOICE' = keep ] || put GEV_VOICE_PROVIDER '$PROVIDER_CHOICE'
grep -qE '^GEV_RATELIMIT_OPENAI_PER_MIN=[0-9]' .env || put GEV_RATELIMIT_OPENAI_PER_MIN 6
# env_file is read at container start, so a recreate is enough — no rebuild.
docker compose up -d
REMOTE
  then
    ok "staging .env updated, container recreated, /api/realtime/token capped at 6 req/min/IP"
    dim "  check: curl -su gev:<password> https://gev.enerlens.com/api/voice/config"
  else
    bad "staging update failed — the previous container is still serving"
  fi
fi

# ── 6. what to expect now ────────────────────────────────────────────────────
echo
bold "Done — key ${MASKED} installed."
if [ "$PROVIDER_CHOICE" != keep ]; then
  dim "The mic now goes through OpenAI Realtime: one speech-to-speech session, ~1 s to first sound,"
  dim "against ~4-8 s per turn on the OpenRouter path it replaces."
  dim "Cost, standard tier: roughly \$1.80-\$10 per 30 minutes of talking; the mini tier is ~5x cheaper."
  echo
  warn "RATE, not price, is what you will hit first. Each response re-sends the whole session"
  warn "prefix (instructions + 29 tool schemas): ~10 900 input tokens before you say a word."
  warn "An entry-tier account allows 40 000 tokens per MINUTE — three responses, and one spoken"
  warn "command that calls a tool costs two. The dock now says so and retries the swallowed turn,"
  warn "but the real fix is the ceiling: platform.openai.com/settings/organization/limits"
  dim "The app stops itself at \$5 per session (src/voice/voiceCost.js) — that is a client-side guard,"
  dim "not a spend limit. Set the real one at platform.openai.com/settings/organization/limits."
fi
case "$VOICE_LANGUAGE" in
  ''|en|en-*) ;;
  *)
    echo
    warn "GEV_VOICE_LANGUAGE=$VOICE_LANGUAGE will be IGNORED on this path."
    warn "/api/realtime/token sends GEV_VOICE_INSTRUCTION_LINES only (the \`instructions:\` field"
    warn "of the session config in openAiRealtimeProxy(), vite.config.js ~16852); the"
    warn "voiceLanguageInstruction() lines are added on the OpenRouter path alone. The realtime mic"
    warn "will answer in English until that instruction is passed through too."
    ;;
esac
echo
dim "Verify locally:  npm run dev  →  curl -s localhost:5173/api/voice/config"
dim "It should report provider \"openai\" and configured.openai true."

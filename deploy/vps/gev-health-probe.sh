#!/usr/bin/env bash
#
# God's Eye View — availability probe.
#
# Answers one question the deploy timer cannot: is the page a reader would
# open actually answering? `gev-deploy.sh` knows the container was built and
# started; it learns nothing about the Cloudflare tunnel, DNS, an edge rule, or
# a process that came up and then wedged. Every outage on this deployment so
# far has been found by somebody looking at a screen.
#
# FROM THE VPS, NOT FROM A LAPTOP. The Cloudflare rule in front of this origin
# is per source address and Claude runs on the same public IP as the owner's
# browser: a probe from there rate-limits the person it was meant to protect.
# The box has its own address and is idle.
#
# Two targets, because they fail differently and the difference is the
# diagnosis:
#   origin  — http://127.0.0.1:4173/healthz, the container itself.
#   public  — https://<host>/healthz, through the tunnel and the edge.
# origin up + public down is a tunnel or DNS fault; both down is the app.
#
# /healthz is deliberately the target: it is the one route the Basic gate
# leaves open, so this needs no credential, and it echoes the address the
# in-app throttles will key a caller on — which is how the deployment checks
# that "per IP" is per IP and not one bucket for the whole tunnel.
#
# Appends one line per run to $STATE/health.log and keeps the last N. Nothing
# alerts: this is the record you read AFTER someone says "it was down", so the
# answer is a timestamp instead of a shrug.
set -uo pipefail

ROOT=${GEV_ROOT:-/opt/gev}
STATE="$ROOT/state"
LOG_FILE="$STATE/health.log"
# ~7 days at one run every 5 minutes.
MAX_LINES=${GEV_HEALTH_LOG_LINES:-2016}
TIMEOUT=${GEV_HEALTH_TIMEOUT:-10}

mkdir -p "$STATE"

# The public host, from the same .env the container reads. GEV_PUBLIC_HOST is a
# comma-separated allowlist whose FIRST entry is the real hostname.
PUBLIC_HOST=${GEV_PUBLIC_HOST:-}
if [ -z "$PUBLIC_HOST" ] && [ -r "$ROOT/.env" ]; then
  PUBLIC_HOST=$(sed -n 's/^GEV_PUBLIC_HOST=//p' "$ROOT/.env" | head -n1 | cut -d, -f1 | tr -d '"'"'"' \r')
fi
PORT=${GEV_PORT:-4173}

# Emits "<http_code> <seconds> <body-or-error>" for one URL.
probe() {
  local url=$1 out code seconds body
  out=$(curl -sS --max-time "$TIMEOUT" -o /tmp/gev-health-body.$$ -w '%{http_code} %{time_total}' "$url" 2>/tmp/gev-health-err.$$)
  local rc=$?
  code=${out%% *}
  seconds=${out##* }
  if [ $rc -ne 0 ]; then
    printf '000 %s %s' "${seconds:-0}" "$(tr -d '\n' </tmp/gev-health-err.$$ | cut -c1-120)"
  else
    body=$(tr -d '\n' </tmp/gev-health-body.$$ | cut -c1-160)
    printf '%s %s %s' "$code" "$seconds" "$body"
  fi
  rm -f /tmp/gev-health-body.$$ /tmp/gev-health-err.$$
}

TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
ORIGIN=$(probe "http://127.0.0.1:${PORT}/healthz")
if [ -n "$PUBLIC_HOST" ]; then
  PUBLIC=$(probe "https://${PUBLIC_HOST}/healthz")
else
  PUBLIC="--- 0 no GEV_PUBLIC_HOST configured"
fi

printf '%s origin=%s public=%s\n' "$TS" "$ORIGIN" "$PUBLIC" >>"$LOG_FILE"

# Trim in place so the file keeps its inode (a tail -f survives the rotation).
if [ "$(wc -l <"$LOG_FILE")" -gt "$MAX_LINES" ]; then
  tail -n "$MAX_LINES" "$LOG_FILE" >"$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
fi

# Exit non-zero when the PUBLIC page is down, so `systemctl status` and the
# journal carry the fault too — the log file is for history, this is for now.
case "$PUBLIC" in
  2*) exit 0 ;;
  *) echo "gev-health-probe: public check failed: $PUBLIC" >&2; exit 1 ;;
esac

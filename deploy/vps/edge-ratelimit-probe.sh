#!/usr/bin/env bash
#
# God's Eye View — does the edge still rate-limit ALL of /api?
#
# The rule in front of gev.enerlens.com is 30 requests per 10 seconds per
# address on `/api`, blocking for 10 s (measured 2026-09-09). A GEV page makes
# about six `/api` calls to boot, so the page never trips it — a QA harness,
# a couple of tabs reloading, or two people behind one NAT do, and for those
# ten seconds EVERY `/api` answers 429: the mic reads "Could not reach voice
# configuration (HTTP 429)", live layers stall, proxied tiles go grey.
#
# The rule belongs on the five routes that spend a key, not on open data. The
# expression to paste in the Cloudflare dashboard is in docs/DEPLOY.md; this
# script is how you check which shape is live, before and after.
#
# RUN IT FROM THE VPS. The limit is per source address, and Claude runs on the
# owner's public IP: probing from the laptop blocks the owner's own browser for
# ten seconds, which happened three times on 2026-09-09.
#
# What it does: bursts a KEYLESS /api route that no correct rule would ever
# throttle, plus `/` as a control. It spends no API key and reads no secret —
# `/api/voice/config` behind the Basic gate answers 401, and a 401 proves the
# request reached the origin just as well as a 200 does. Only a 429 with
# Cloudflare's `error code: 1015` means the edge answered instead.
#
#   ./edge-ratelimit-probe.sh                      # gev.enerlens.com, 40 requests
#   ./edge-ratelimit-probe.sh --host h --count 40
set -uo pipefail

HOST=${GEV_PUBLIC_HOST_PROBE:-gev.enerlens.com}
COUNT=40
PATH_UNDER_TEST=/api/voice/config

while [ $# -gt 0 ]; do
  case "$1" in
    --host) HOST=$2; shift 2 ;;
    --count) COUNT=$2; shift 2 ;;
    --path) PATH_UNDER_TEST=$2; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

case "$(hostname -f 2>/dev/null || hostname)" in
  *hstgr*|*srv*) : ;;
  *) echo "WARNING: this does not look like the VPS. A burst from the owner's"
     echo "         address blocks their own browser for ten seconds."
     echo "         Set GEV_EDGE_PROBE_ANYWAY=1 to run it here anyway."
     [ "${GEV_EDGE_PROBE_ANYWAY:-0}" = "1" ] || exit 3 ;;
esac

# Bursts one path and reports where (if anywhere) the edge cut in.
# Diagnostics go to stderr so the caller can capture the verdict on stdout.
burst() {
  local label=$1 url=$2 i code first_429=0 started elapsed retry cf
  started=$(date +%s)
  for ((i = 1; i <= COUNT; i++)); do
    code=$(curl -s -o /tmp/gev-edge-body.$$ -w '%{http_code}' --max-time 10 "$url")
    if [ "$code" = "429" ] && [ "$first_429" = "0" ]; then
      first_429=$i
      elapsed=$(( $(date +%s) - started ))
      retry=$(curl -sI --max-time 10 "$url" | tr -d '\r' | sed -n 's/^[Rr]etry-[Aa]fter: //p')
      cf=$(grep -o 'error code: [0-9]*' /tmp/gev-edge-body.$$ 2>/dev/null | head -n1)
      printf '  %-24s FIRST 429 at request %d (~%ss)  retry-after=%s  %s\n' \
        "$label" "$i" "$elapsed" "${retry:-none}" "${cf:-origin 429, not the edge}" >&2
    fi
  done
  rm -f /tmp/gev-edge-body.$$
  if [ "$first_429" = "0" ]; then
    printf '  %-24s %d requests, no 429\n' "$label" "$COUNT" >&2
  fi
  printf '%s' "$first_429"
}

echo "edge rate-limit probe — https://$HOST"
echo "  (a 401 is expected and fine: the Basic gate proves the origin answered)"
echo
CONTROL=$(burst "GET /" "https://$HOST/")
echo
echo "  waiting out any block before the second burst..."
sleep 15
UNDER_TEST=$(burst "GET $PATH_UNDER_TEST" "https://$HOST$PATH_UNDER_TEST")
echo

if [ "$UNDER_TEST" != "0" ]; then
  echo "VERDICT: the edge rule still covers ALL of /api — a keyless route was"
  echo "         throttled at request $UNDER_TEST. Narrow it to the five"
  echo "         key-spending paths (docs/DEPLOY.md) or delete it: the in-app"
  echo "         throttles already do this per real address."
  exit 1
fi
if [ "$CONTROL" != "0" ]; then
  echo "VERDICT: even '/' is throttled — the rule is wider than /api."
  exit 1
fi
echo "VERDICT: keyless /api is not throttled at the edge. Correct shape."

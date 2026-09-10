#!/bin/bash
# Pull-based deploy pipeline, run every minute by sketch-aquarium-update.timer.
#
#   1. fetch origin/main; stop if the server already runs it
#   2. ask GitHub whether that commit's "test" workflow passed (skip if it failed,
#      wait if it is still running; deploy anyway if the API cannot be reached or
#      the repo has no checks at all)
#   3. reset the checkout to the commit, reinstall deps if requirements changed,
#      regenerate sheets, refresh nginx config, restart the service
#
# Logs to the journal (journalctl -u sketch-aquarium-update) and /var/log/sketch-aquarium-update.log.
set -uo pipefail
APP=/opt/sketch_aquarium
REPO="bhanuprakash0501/anime"
BRANCH=main
LOG=/var/log/sketch-aquarium-update.log
STATE=/var/lib/sketch-aquarium
mkdir -p "$STATE"

log() { echo "$(date '+%F %T') $*" | tee -a "$LOG"; }

cd "$APP" || exit 1
set -a; [ -f deploy/env ] && . deploy/env; set +a
REQUIRE_CI=${REQUIRE_CI:-1}

git fetch -q origin "$BRANCH" || { log "fetch failed"; exit 0; }
NEW=$(git rev-parse "origin/$BRANCH")
CUR=$(git rev-parse HEAD 2>/dev/null || echo none)
[ "$NEW" = "$CUR" ] && exit 0

# don't hammer GitHub / retry a commit we already decided to skip
if [ -f "$STATE/skipped" ] && [ "$(cat "$STATE/skipped")" = "$NEW" ]; then exit 0; fi

if [ "$REQUIRE_CI" = "1" ]; then
  JSON=$(curl -sf -m 15 -H "Accept: application/vnd.github+json" \
        "https://api.github.com/repos/$REPO/commits/$NEW/check-runs?per_page=20" || true)
  if [ -z "$JSON" ]; then
    log "GitHub API unreachable; deploying ${NEW:0:8} without a CI check"
  else
    VERDICT=$(printf '%s' "$JSON" | python3 -c '
import json,sys
d=json.load(sys.stdin); runs=[r for r in d.get("check_runs",[]) if r.get("name")=="test"]
if not runs: print("none")
elif any(r["status"]!="completed" for r in runs): print("pending")
elif all(r["conclusion"]=="success" for r in runs): print("success")
else: print("failure")')
    case "$VERDICT" in
      pending) log "CI still running for ${NEW:0:8}; will check again"; exit 0 ;;
      failure) log "CI FAILED for ${NEW:0:8}; not deploying"; echo "$NEW" > "$STATE/skipped"; exit 0 ;;
      none)    log "no CI results for ${NEW:0:8}; deploying" ;;
      success) log "CI passed for ${NEW:0:8}" ;;
    esac
  fi
fi

log "updating ${CUR:0:8} -> ${NEW:0:8}"
REQ_BEFORE=$(git show HEAD:requirements.txt 2>/dev/null | md5sum)
NGX_BEFORE=$(git show HEAD:deploy/nginx-sketch-aquarium.conf 2>/dev/null | md5sum)
git reset -q --hard "$NEW" || { log "reset failed"; exit 0; }
sed -i 's/\r$//' deploy/*.sh deploy/env 2>/dev/null
chmod +x deploy/*.sh

if [ "$(md5sum < requirements.txt)" != "$REQ_BEFORE" ] || [ ! -x .venv/bin/python ]; then
  log "requirements changed; installing"
  [ -x .venv/bin/python ] || python3 -m venv .venv
  sed 's/^opencv-python/opencv-python-headless/' requirements.txt > /tmp/req-server.txt
  .venv/bin/pip install -q -r /tmp/req-server.txt >>"$LOG" 2>&1 || log "pip install had errors"
fi

.venv/bin/python templates.py >/dev/null 2>>"$LOG" || log "templates.py failed"

if [ "$(md5sum < deploy/nginx-sketch-aquarium.conf)" != "$NGX_BEFORE" ]; then
  cp deploy/nginx-sketch-aquarium.conf /etc/nginx/sites-available/sketch-aquarium
  nginx -t >>"$LOG" 2>&1 && systemctl reload nginx && log "nginx reloaded"
fi
cp deploy/sketch-aquarium.service /etc/systemd/system/sketch-aquarium.service
cp deploy/sketch-aquarium-update.service deploy/sketch-aquarium-update.timer /etc/systemd/system/ 2>/dev/null
systemctl daemon-reload
systemctl restart sketch-aquarium
sleep 2
if systemctl is-active -q sketch-aquarium && curl -sf -m 5 "http://127.0.0.1:${PORT:-8000}/api/info" >/dev/null; then
  log "deployed ${NEW:0:8} OK"
  rm -f "$STATE/skipped"
else
  log "service unhealthy after ${NEW:0:8}; rolling back to ${CUR:0:8}"
  git reset -q --hard "$CUR" && systemctl restart sketch-aquarium
  echo "$NEW" > "$STATE/skipped"
fi

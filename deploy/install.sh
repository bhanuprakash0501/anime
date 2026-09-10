#!/bin/bash
# Server-side installer. Run as root on the container after the code has been copied
# to /opt/sketch_aquarium (deploy.py does both). Safe to re-run.
set -euo pipefail
APP=/opt/sketch_aquarium
cd "$APP"

echo "== packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
# python + venv, and the shared libraries opencv-python needs on a headless Debian
apt-get install -y -qq python3 python3-venv python3-pip libgl1 libglib2.0-0 libsm6 libxext6 libxrender1 fonts-dejavu-core curl nginx git >/dev/null

echo "== git checkout (so the update timer can pull from GitHub)"
if [ ! -d .git ]; then
  git init -q -b main
  git remote add origin https://github.com/bhanuprakash0501/anime.git
fi
git config --global --add safe.directory "$APP" >/dev/null 2>&1 || true
if git fetch -q origin main; then
  # adopt the GitHub commit without touching runtime data (sprites/, inbox/, .venv are ignored)
  git reset -q --hard origin/main || true
  sed -i 's/$//' deploy/*.sh deploy/env 2>/dev/null
  chmod +x deploy/*.sh
fi

echo "== python environment"
if [ ! -x .venv/bin/python ]; then python3 -m venv .venv; fi
.venv/bin/pip install -q --upgrade pip
# headless build: no GUI libraries needed on a server
sed 's/^opencv-python/opencv-python-headless/' requirements.txt > /tmp/req-server.txt
.venv/bin/pip install -q -r /tmp/req-server.txt

echo "== sheets"
.venv/bin/python templates.py >/dev/null
mkdir -p sprites inbox/done inbox/failed
[ -f sprites/manifest.json ] || echo "[]" > sprites/manifest.json

echo "== service"
set -a; . deploy/env; set +a
if pidof systemd >/dev/null 2>&1 && command -v systemctl >/dev/null; then
  cp deploy/sketch-aquarium.service /etc/systemd/system/sketch-aquarium.service
  cp deploy/sketch-aquarium-update.service deploy/sketch-aquarium-update.timer /etc/systemd/system/
  systemctl daemon-reload
  systemctl enable --now sketch-aquarium-update.timer >/dev/null
  systemctl enable sketch-aquarium >/dev/null
  systemctl restart sketch-aquarium
  sleep 2
  systemctl --no-pager --lines=8 status sketch-aquarium || true
else
  # container without systemd: run detached, restart on every install
  pkill -f "sketch_aquarium/app.py" || true
  nohup .venv/bin/python -u app.py --port "$PORT" --ttl "$TTL" --public-url "$PUBLIC_URL" --admin-key "$ADMIN_KEY" > /var/log/sketch-aquarium.log 2>&1 &
  echo "started with nohup (no systemd); log: /var/log/sketch-aquarium.log"
  sleep 2
fi

echo "== nginx"
cp deploy/nginx-sketch-aquarium.conf /etc/nginx/sites-available/sketch-aquarium
ln -sf /etc/nginx/sites-available/sketch-aquarium /etc/nginx/sites-enabled/sketch-aquarium
rm -f /etc/nginx/sites-enabled/default
# nginx runs as www-data and must read the sprites the app writes
chmod 755 /opt /opt/sketch_aquarium /opt/sketch_aquarium/sprites /opt/sketch_aquarium/aquarium
nginx -t && systemctl enable nginx >/dev/null && systemctl restart nginx

echo "== check"
curl -s -o /dev/null -w "local http %{http_code}\n" "http://127.0.0.1:${PORT}/" || true
curl -s "http://127.0.0.1:${PORT}/api/info" || true
echo

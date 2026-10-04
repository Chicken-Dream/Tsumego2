#!/bin/bash
# Runs on the EC2 host (via SSM). Expects the server tarball base64 in $TARBALL_B64.
set -euo pipefail
HOST=tsumego.15-156-243-42.sslip.io
mkdir -p /opt/tsumego/app
echo "$TARBALL_B64" | base64 -d | tar -xz -C /opt/tsumego/app
cd /opt/tsumego/app && npm ci --omit=dev --no-audit --no-fund --silent

cat > /etc/systemd/system/tsumego.service <<UNIT
[Unit]
Description=Tsumego game server
After=network-online.target
[Service]
DynamicUser=yes
WorkingDirectory=/opt/tsumego/app
Environment=PORT=8081
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=2
MemoryMax=96M
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable tsumego.service >/dev/null 2>&1
systemctl restart tsumego.service

# Add our own Caddy site (leaves the tank-duel site untouched).
if ! grep -q "$HOST" /etc/caddy/Caddyfile; then
  cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak.$(date +%s)
  printf '\n%s {\n  reverse_proxy localhost:8081\n}\n' "$HOST" >> /etc/caddy/Caddyfile
  /usr/local/bin/caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
  /usr/local/bin/caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
fi
sleep 2
systemctl is-active tsumego.service tanks.service caddy.service
curl -s localhost:8081/health; echo

#!/usr/bin/env bash
# Installiert den systemd-Service "mcbots" und den Befehl "mcbots".
# Aufruf: sudo ./install.sh
set -euo pipefail

if [ "$EUID" -ne 0 ]; then echo "Bitte mit sudo ausfuehren: sudo ./install.sh"; exit 1; fi

DIR="$(cd "$(dirname "$0")" && pwd)"
RUN_USER="${SUDO_USER:-root}"
NODE_BIN="$(command -v node || true)"
[ -z "$NODE_BIN" ] && { echo "node nicht gefunden (Node 18+ installieren)"; exit 1; }

[ -d "$DIR/node_modules/mineflayer" ] || sudo -u "$RUN_USER" bash -c "cd '$DIR' && npm install"

# config.json ist nicht im Repo (enthaelt Account-Daten) - beim ersten Setup aus der Vorlage anlegen
if [ ! -f "$DIR/config.json" ]; then
  sudo -u "$RUN_USER" cp "$DIR/config.example.json" "$DIR/config.json"
  echo "config.json aus Vorlage erstellt - jetzt anpassen: mcbots config"
fi

cat > /etc/systemd/system/mcbots.service <<EOF
[Unit]
Description=Minecraft AFK Bots (Mineflayer)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$DIR
ExecStart=$NODE_BIN $DIR/index.js
Restart=on-failure
RestartSec=10
KillSignal=SIGINT
TimeoutStopSec=15

[Install]
WantedBy=multi-user.target
EOF

install -m 755 "$DIR/mcbots" /usr/local/bin/mcbots
sed -i "s|__DIR__|$DIR|" /usr/local/bin/mcbots

systemctl daemon-reload
echo "Fertig. Nutze jetzt: mcbots start | stop | restart | status | logs | enable | disable | config | update"

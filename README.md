# MCBots

Mineflayer-AFK-Bots für Premium-Accounts (Microsoft-Login), als systemd-Service.

## Setup auf einem neuen Server

Voraussetzungen: Node.js 18+, npm, git

```bash
git clone https://github.com/Dxrknesx/mcbots.git /opt/mcbot
cd /opt/mcbot
sudo bash install.sh
mcbots config          # host + Account-Mails eintragen
node index.js          # einmal von Hand: Microsoft-Login-Codes bestätigen, dann Strg+C
mcbots start
mcbots enable
```

## Befehle

| Befehl | Funktion |
|---|---|
| `mcbots start / stop / restart` | Bots steuern |
| `mcbots logs` | Live-Log |
| `mcbots config` | config.json bearbeiten |
| `mcbots update` | Neueste Version pullen, installieren, neu starten |

## Config

- `accounts[].username` – E-Mail des Microsoft-Accounts
- `accounts[].joinCommand` / `joinCommands` – Befehle nach dem Join (z. B. `/afk`)
- `humanize` – zufällige Reconnect-Zeit zwischen `reconnectMinMs` und `reconnectMaxMs`
- `debug` – Verbindungsphasen, Pakete und Status im Log
- `logChat` – Chat ins Log schreiben

`config.json` und `auth-cache/` (Login-Tokens) werden **nicht** ins Repo hochgeladen.

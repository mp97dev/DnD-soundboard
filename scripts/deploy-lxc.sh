#!/usr/bin/env bash
# Provisioning one-shot del soundboard dentro un LXC Debian/Ubuntu.
# Da eseguire come root nel container:
#   REPO_URL=https://github.com/<tu>/dnd-soundboard.git bash deploy-lxc.sh
#
# Installa Node, ffmpeg, yt-dlp, clona il repo, builda il renderer e configura
# due unità systemd: il server e un timer di auto-aggiornamento (ogni 15 min).
set -euo pipefail

# >>> CONFIGURA QUI (o passa via variabili d'ambiente) <<<
REPO_URL="${REPO_URL:-https://github.com/mp97dev/dnd-soundboard.git}"
BRANCH="${BRANCH:-main}"
APP_DIR="${APP_DIR:-/opt/dnd-soundboard}"
DATA_DIR="${DATA_DIR:-/var/lib/dnd-soundboard}"   # dati persistenti, fuori dal repo
APP_USER="${APP_USER:-soundboard}"
PORT="${PORT:-8080}"
NODE_MAJOR="${NODE_MAJOR:-20}"

[ "$(id -u)" -eq 0 ] || { echo "Eseguire come root." >&2; exit 1; }

echo "==> Pacchetti di sistema"
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y curl git ca-certificates ffmpeg python3 sudo

echo "==> Node.js $NODE_MAJOR"
node_ok=0
if command -v node >/dev/null 2>&1; then
  [ "$(node -v | sed 's/v\([0-9]*\).*/\1/')" -ge "$NODE_MAJOR" ] && node_ok=1
fi
if [ "$node_ok" -eq 0 ]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi

echo "==> Utente di sistema $APP_USER"
id "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"

echo "==> Repo in $APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" remote set-url origin "$REPO_URL"
  git -C "$APP_DIR" fetch --depth 1 origin "$BRANCH"
  git -C "$APP_DIR" reset --hard "origin/$BRANCH"
else
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi

mkdir -p "$DATA_DIR"
chown -R "$APP_USER:$APP_USER" "$APP_DIR" "$DATA_DIR"
chmod +x "$APP_DIR/scripts/update.sh"

echo "==> Dipendenze + yt-dlp + build renderer (come $APP_USER)"
sudo -u "$APP_USER" env ELECTRON_SKIP_BINARY_DOWNLOAD=1 bash -lc \
  "cd '$APP_DIR' && npm install --no-audit --no-fund && npm run fetch:ytdlp && npm run build:renderer"

echo "==> Unità systemd"
render_unit() {
  sed -e "s#@APP_DIR@#$APP_DIR#g" \
      -e "s#@DATA_DIR@#$DATA_DIR#g" \
      -e "s#@APP_USER@#$APP_USER#g" \
      -e "s#@PORT@#$PORT#g" \
      -e "s#@REPO_URL@#$REPO_URL#g" \
      -e "s#@BRANCH@#$BRANCH#g" \
      "$1"
}
render_unit "$APP_DIR/scripts/dnd-soundboard.service"        > /etc/systemd/system/dnd-soundboard.service
render_unit "$APP_DIR/scripts/dnd-soundboard-update.service" > /etc/systemd/system/dnd-soundboard-update.service
cp "$APP_DIR/scripts/dnd-soundboard-update.timer"             /etc/systemd/system/dnd-soundboard-update.timer

systemctl daemon-reload
systemctl enable --now dnd-soundboard.service
systemctl enable --now dnd-soundboard-update.timer

IP=$(hostname -I 2>/dev/null | awk '{print $1}')
echo
echo "==> Fatto. Apri dal tablet:  http://${IP:-<ip-lxc>}:$PORT"
echo "    Log server:   journalctl -u dnd-soundboard -f"
echo "    Aggiornamento: systemctl start dnd-soundboard-update   (o attendi il timer)"

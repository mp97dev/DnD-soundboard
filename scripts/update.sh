#!/usr/bin/env bash
# Aggiorna il soundboard dal repo pubblico e riavvia il servizio, SOLO se ci
# sono nuovi commit. Idempotente: se è già aggiornato non fa nulla.
# Eseguito dal timer systemd (come root) oppure a mano.
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/mp97dev/dnd-soundboard.git}"
APP_DIR="${APP_DIR:-/opt/dnd-soundboard}"
BRANCH="${BRANCH:-main}"
SERVICE="${SERVICE:-dnd-soundboard}"
APP_USER="${APP_USER:-soundboard}"

# Esegue un comando come l'utente proprietario dell'app (git/npm non devono
# girare da root sui file di APP_USER). Se non siamo root, esegue diretto.
run_as_app() {
  if [ "$(id -u)" -eq 0 ]; then
    sudo -u "$APP_USER" env REPO_URL="$REPO_URL" BRANCH="$BRANCH" \
      ELECTRON_SKIP_BINARY_DOWNLOAD=1 bash -lc "$1"
  else
    ELECTRON_SKIP_BINARY_DOWNLOAD=1 bash -lc "$1"
  fi
}

restart_service() {
  if [ "$(id -u)" -eq 0 ]; then
    systemctl restart "$SERVICE"
  else
    sudo systemctl restart "$SERVICE"
  fi
}

cd "$APP_DIR"

echo "==> Controllo aggiornamenti da $REPO_URL ($BRANCH)"
run_as_app "cd '$APP_DIR' && git fetch --depth 1 origin '$BRANCH'"
LOCAL=$(run_as_app "cd '$APP_DIR' && git rev-parse HEAD" | tr -d '[:space:]')
REMOTE=$(run_as_app "cd '$APP_DIR' && git rev-parse 'origin/$BRANCH'" | tr -d '[:space:]')

if [ "$LOCAL" = "$REMOTE" ]; then
  echo "==> Già aggiornato ($LOCAL). Niente da fare."
  exit 0
fi

echo "==> Aggiornamento $LOCAL -> $REMOTE"
run_as_app "cd '$APP_DIR' && git reset --hard 'origin/$BRANCH'"

echo "==> npm install + yt-dlp + build renderer"
run_as_app "cd '$APP_DIR' && npm install --no-audit --no-fund && npm run fetch:ytdlp && npm run build:renderer"

echo "==> Riavvio $SERVICE"
restart_service
echo "==> Fatto."

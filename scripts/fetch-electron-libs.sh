#!/usr/bin/env bash
# Librerie di sistema che Electron/Chromium si aspetta e che alcune installazioni
# minime (WSL2, container, immagini server) non hanno: libnss3, libnspr4,
# libasound2. Senza, Electron non parte affatto — "Process failed to launch!".
#
# La via maestra resta:
#   sudo apt-get install -y libnss3 libnspr4 libasound2t64
#
# Questo script è per quando sudo non c'è: scarica gli stessi pacchetti e li
# estrae in .electron-libs/, che scripts/soak.js e i test e2e aggiungono da soli
# a LD_LIBRARY_PATH. Non tocca niente fuori dalla cartella del progetto.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/.electron-libs"
PKGS=(libnss3 libnspr4 libasound2t64)

if ! command -v apt-get >/dev/null || ! command -v dpkg-deb >/dev/null; then
  echo "Servono apt-get e dpkg-deb (distribuzione Debian/Ubuntu)." >&2
  echo "Su altre distribuzioni installa a mano gli equivalenti di: ${PKGS[*]}" >&2
  exit 1
fi

mkdir -p "$DEST/debs"
cd "$DEST/debs"

echo "Scarico: ${PKGS[*]}"
# apt-get download non richiede root: scrive i .deb nella cartella corrente.
# libasound2t64 esiste da Ubuntu 24.04; prima si chiamava libasound2.
for pkg in "${PKGS[@]}"; do
  if ! apt-get download "$pkg" 2>/dev/null; then
    if [ "$pkg" = "libasound2t64" ]; then
      echo "  $pkg non disponibile, provo libasound2"
      apt-get download libasound2
    else
      echo "  impossibile scaricare $pkg" >&2
      exit 1
    fi
  fi
done

echo "Estraggo in $DEST"
for deb in *.deb; do
  dpkg-deb -x "$deb" "$DEST/extracted"
done

LIBDIR="$DEST/extracted/usr/lib/$(uname -m)-linux-gnu"
if [ ! -d "$LIBDIR" ]; then
  echo "Estrazione riuscita ma $LIBDIR non esiste: architettura inattesa." >&2
  exit 1
fi

echo
echo "Fatto. Librerie in: $LIBDIR"
echo "npm run soak e npm run test:e2e le useranno da sole."

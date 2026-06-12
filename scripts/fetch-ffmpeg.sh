#!/usr/bin/env bash
# Scarica ffmpeg.exe + ffprobe.exe nella directory bin/ per il packaging Windows.
# Usa i build BtbN (GPL, win64). Richiede: curl, unzip.
set -euo pipefail

BIN_DIR="$(cd "$(dirname "$0")/.." && pwd)/bin"

# Salta se esistono già entrambi (--force per sovrascrivere)
if [ -f "$BIN_DIR/ffmpeg.exe" ] && [ -f "$BIN_DIR/ffprobe.exe" ] && [ "${1:-}" != "--force" ]; then
  echo "==> ffmpeg.exe già presente in bin/, skip (usa --force per aggiornare)"
  exit 0
fi

ZIP_URL="https://github.com/BtbN/ffmpeg-builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "==> Downloading ffmpeg (Windows build) ..."
curl -fL "$ZIP_URL" -o "$TMP/ffmpeg.zip"

echo "==> Extracting ffmpeg.exe and ffprobe.exe ..."
mkdir -p "$BIN_DIR"
# -j: junk paths (no subdirectory), -o: overwrite
unzip -jo "$TMP/ffmpeg.zip" "*/bin/ffmpeg.exe" "*/bin/ffprobe.exe" -d "$BIN_DIR"

echo "==> Done: $(ls -lh "$BIN_DIR/ffmpeg.exe" "$BIN_DIR/ffprobe.exe")"

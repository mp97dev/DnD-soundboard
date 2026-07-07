#!/usr/bin/env bash
# Scarica ffmpeg + ffprobe nella directory bin/ per il packaging.
# Default: build Linux statica. Con --win scarica ffmpeg.exe/ffprobe.exe.
# Usa i build BtbN (GPL). Richiede: curl, unzip (win) / tar+xz (linux).
set -euo pipefail

BIN_DIR="$(cd "$(dirname "$0")/.." && pwd)/bin"

WIN=0
FORCE=0
for arg in "$@"; do
  case "$arg" in
    --win) WIN=1 ;;
    --force) FORCE=1 ;;
  esac
done

if [ "$WIN" = 1 ]; then
  # Salta se esistono già entrambi (--force per sovrascrivere)
  if [ -f "$BIN_DIR/ffmpeg.exe" ] && [ -f "$BIN_DIR/ffprobe.exe" ] && [ "$FORCE" != 1 ]; then
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
else
  if [ -f "$BIN_DIR/ffmpeg" ] && [ -f "$BIN_DIR/ffprobe" ] && [ "$FORCE" != 1 ]; then
    echo "==> ffmpeg già presente in bin/, skip (usa --force per aggiornare)"
    exit 0
  fi

  TAR_URL="https://github.com/BtbN/ffmpeg-builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz"
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT

  echo "==> Downloading ffmpeg (Linux static build) ..."
  curl -fL "$TAR_URL" -o "$TMP/ffmpeg.tar.xz"

  echo "==> Extracting ffmpeg and ffprobe ..."
  mkdir -p "$BIN_DIR"
  tar -xJf "$TMP/ffmpeg.tar.xz" -C "$TMP"
  find "$TMP" -type f \( -name ffmpeg -o -name ffprobe \) -exec cp {} "$BIN_DIR/" \;
  chmod +x "$BIN_DIR/ffmpeg" "$BIN_DIR/ffprobe"

  echo "==> Done: $(ls -lh "$BIN_DIR/ffmpeg" "$BIN_DIR/ffprobe")"
fi

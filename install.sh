#!/usr/bin/env bash
set -euo pipefail

# Default: ultima release (yt-dlp va tenuto aggiornato, YouTube cambia spesso).
# Per fissare una versione: YTDLP_VERSION=2025.06.10 ./install.sh
YTDLP_VERSION="${YTDLP_VERSION:-latest}"
BIN_DIR="$(cd "$(dirname "$0")" && pwd)/bin"

detect_platform() {
  case "$(uname -s)" in
    Linux*)  echo "linux" ;;
    Darwin*) echo "macos" ;;
    MINGW*|MSYS*|CYGWIN*) echo "windows" ;;
    *) echo "unknown" ;;
  esac
}

PLATFORM=$(detect_platform)

if [ "$PLATFORM" = "unknown" ]; then
  echo "Unsupported platform: $(uname -s)" >&2
  exit 1
fi

echo "==> Installing npm dependencies..."
npm install

echo "==> Fetching yt-dlp..."
bash "$(dirname "$0")/scripts/fetch-ytdlp.sh"

echo "==> Checking for ffmpeg..."
if command -v ffmpeg &>/dev/null; then
  echo "    ffmpeg found: $(ffmpeg -version 2>&1 | head -1)"
else
  echo ""
  echo "  WARNING: ffmpeg not found in PATH."
  echo "  yt-dlp requires ffmpeg to convert audio to mp3."
  echo ""
  case "$PLATFORM" in
    linux)   echo "  Install with: sudo apt install ffmpeg  (or your distro's package manager)" ;;
    macos)   echo "  Install with: brew install ffmpeg" ;;
    windows) echo "  Download from https://ffmpeg.org/download.html and add to PATH" ;;
  esac
  echo ""
fi

echo "==> Done. Run 'npm run dev' to start the app."

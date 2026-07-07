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

# Electron needs a few system libraries that minimal Debian/Ubuntu/WSL
# installs lack (the app silently fails to launch without them).
if [ "$PLATFORM" = "linux" ] && command -v apt-get &>/dev/null; then
  echo "==> Checking Electron system libraries..."
  ELECTRON_BIN="node_modules/electron/dist/electron"
  if [ -f "$ELECTRON_BIN" ] && ldd "$ELECTRON_BIN" 2>/dev/null | grep -q "not found"; then
    echo "    Missing libraries detected:"
    ldd "$ELECTRON_BIN" | grep "not found" | awk '{print "      " $1}'
    # libasound2 è "libasound2t64" da Ubuntu 24.04 in poi
    ALSA_PKG=$(apt-cache show libasound2t64 &>/dev/null && echo libasound2t64 || echo libasound2)
    PKGS="libnss3 libnspr4 $ALSA_PKG libgtk-3-0 libgbm1 libxss1"
    echo "    Installing: $PKGS"
    sudo apt-get install -y $PKGS || {
      echo "    Could not install automatically. Run:"
      echo "      sudo apt-get install -y $PKGS"
    }
  else
    echo "    OK"
  fi
fi

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

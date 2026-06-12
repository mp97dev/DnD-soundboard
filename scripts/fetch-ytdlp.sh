#!/usr/bin/env bash
# Scarica il binario yt-dlp nella directory bin/.
# Usage: fetch-ytdlp.sh [--win]   (--win: scarica anche yt-dlp.exe per il packaging Windows)
set -euo pipefail

YTDLP_VERSION="${YTDLP_VERSION:-latest}"
BIN_DIR="$(cd "$(dirname "$0")/.." && pwd)/bin"
ALSO_WIN=0

for arg in "$@"; do
  [ "$arg" = "--win" ] && ALSO_WIN=1
done

detect_platform() {
  case "$(uname -s)" in
    Linux*)             echo "linux" ;;
    Darwin*)            echo "macos" ;;
    MINGW*|MSYS*|CYGWIN*) echo "windows" ;;
    *)                  echo "unknown" ;;
  esac
}

PLATFORM=$(detect_platform)
if [ "$PLATFORM" = "unknown" ]; then
  echo "Unsupported platform: $(uname -s)" >&2
  exit 1
fi

if [ "$YTDLP_VERSION" = "latest" ]; then
  BASE_URL="https://github.com/yt-dlp/yt-dlp/releases/latest/download"
else
  BASE_URL="https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}"
fi

mkdir -p "$BIN_DIR"

download() {
  local remote="$1" dest="$2" exec="$3"
  echo "==> Downloading $remote -> bin/$(basename "$dest")"
  curl -fsSL "$BASE_URL/$remote" -o "$dest"
  [ "$exec" = "1" ] && chmod +x "$dest"
  echo "    version: $("$dest" --version)"
}

case "$PLATFORM" in
  linux)   download "yt-dlp_linux" "$BIN_DIR/yt-dlp" 1 ;;
  macos)   download "yt-dlp_macos" "$BIN_DIR/yt-dlp" 1 ;;
  windows) download "yt-dlp.exe"   "$BIN_DIR/yt-dlp.exe" 0 ;;
esac

# Packaging Windows da Linux/macOS
if [ "$ALSO_WIN" = "1" ] && [ "$PLATFORM" != "windows" ]; then
  download "yt-dlp.exe" "$BIN_DIR/yt-dlp.exe" 0
fi

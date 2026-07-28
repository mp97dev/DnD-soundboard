const os = require('os')
const fs = require('fs')
const path = require('path')
const { _electron: electron } = require('@playwright/test')
const { withElectronLibs, preflight } = require('../scripts/electron-libs')

// yt-dlp finto: niente rete, output deterministico con le stesse
// righe di progresso del vero yt-dlp (--newline)
const FAKE_YTDLP = `#!/usr/bin/env bash
mode=meta
out=""
prev=""
for a in "$@"; do
  case "$a" in
    -x) mode=audio ;;
    --skip-download) mode=thumb ;;
    --flat-playlist) mode=playlist ;;
  esac
  [ "$prev" = "-o" ] && out="$a"
  prev="$a"
done
case "$mode" in
  playlist)
    echo '{"entries":[{"id":"plvid111111","title":"PL One","url":"https://youtu.be/plvid111111"},{"id":"plvid222222","title":"PL Two","url":"https://youtu.be/plvid222222"}]}'
    ;;
  meta)
    echo '{"title":"Test Track"}'
    ;;
  audio)
    for p in 10.0 35.5 70.0 100.0; do
      echo "[download]  \${p}% of 3.00MiB at 1.00MiB/s ETA 00:01"
      sleep 0.3
    done
    dest=$(printf '%s' "$out" | sed 's/%(ext)s/mp3/')
    echo "[ExtractAudio] Destination: $dest"
    sleep 0.3
    printf 'fake-mp3-data' > "$dest"
    ;;
  thumb)
    ;;
esac
`

// Avvia l'app con dati isolati in una dir temporanea e yt-dlp finto.
// builtinTracks: tracce builtin per il test; default nessuna (il file
// puntato da SOUNDBOARD_BUILTIN_TRACKS non esiste -> lista vuota)
async function launchApp({ builtinTracks = null } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'soundboard-e2e-'))
  const ytdlp = path.join(tmp, 'yt-dlp')
  fs.writeFileSync(ytdlp, FAKE_YTDLP, { mode: 0o755 })

  const builtinFile = path.join(tmp, 'builtin-tracks.json')
  if (builtinTracks) {
    fs.writeFileSync(builtinFile, JSON.stringify({ version: 1, tracks: builtinTracks }))
  }

  // Undici test che falliscono con "Process failed to launch!" mandano a
  // cercare un bug che non c'è: se Electron non può partire lo si dice qui,
  // con la causa vera. Il controllo va fatto PRIMA del lancio: Playwright non
  // rifiuta la promise, solleva un'eccezione che non si riesce a catturare.
  const blocked = preflight()
  if (blocked) throw new Error(blocked)

  // withElectronLibs: dove mancano le librerie di sistema di Chromium (WSL2,
  // container) usa quelle estratte da scripts/fetch-electron-libs.sh, così la
  // suite gira senza dover esportare LD_LIBRARY_PATH a mano ad ogni run.
  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    env: withElectronLibs({
      ...process.env,
      SOUNDBOARD_DATA_DIR: path.join(tmp, 'data'),
      SOUNDBOARD_BUILTIN_TRACKS: builtinFile,
      YTDLP_PATH: ytdlp
    })
  })
  const page = await app.firstWindow()
  return { app, page }
}

async function createBoard(page, name) {
  await page.getByRole('button', { name: /Nuova board/ }).click()
  await page.getByPlaceholder('Nome board').fill(name)
  await page.getByRole('button', { name: 'Crea' }).click()
}

module.exports = { launchApp, createBoard }

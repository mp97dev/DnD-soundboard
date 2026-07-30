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
// library: { tracks, folders } scritti in index.json prima dell'avvio, per i
//   test che partono da una libreria già popolata invece di costruirla a
//   colpi di interfaccia. I file audio finti vengono creati da soli, se no
//   library:list segna tutto come mancante e le tracce non si trascinano.
async function launchApp({ builtinTracks = null, library = null } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'soundboard-e2e-'))
  const ytdlp = path.join(tmp, 'yt-dlp')
  fs.writeFileSync(ytdlp, FAKE_YTDLP, { mode: 0o755 })

  const builtinFile = path.join(tmp, 'builtin-tracks.json')
  if (builtinTracks) {
    fs.writeFileSync(builtinFile, JSON.stringify({ version: 1, tracks: builtinTracks }))
  }

  // Lingua fissata prima del lancio. Con locale null l'app segue quella del
  // sistema al primo avvio, e i test cercano bottoni per nome ("Crea",
  // "Scarica tutti"): su una macchina in inglese fallirebbero tutti senza che
  // ci sia niente di rotto. Scriverlo qui è anche il modo di provare che il
  // file su disco vince sulla lingua di sistema.
  const dataDir = path.join(tmp, 'data')
  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({ locale: 'it' }))

  if (library) {
    const downloaded = path.join(dataDir, 'library', 'downloaded')
    fs.mkdirSync(downloaded, { recursive: true })
    fs.mkdirSync(path.join(dataDir, 'library', 'thumbnails'), { recursive: true })
    for (const t of library.tracks || []) {
      const rel = t.audioPath || t.mediaPath
      if (rel) fs.writeFileSync(path.join(dataDir, ...rel.split('/')), 'x')
    }
    fs.writeFileSync(
      path.join(dataDir, 'library', 'index.json'),
      JSON.stringify({ version: 1, folders: library.folders || [], tracks: library.tracks || [] })
    )
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
  // dataDir esposto: i test sul trascinamento verificano cosa è finito SU
  // DISCO, non solo cosa si vede. Un bottone disegnato ma non salvato sparisce
  // al riavvio, ed è esattamente il genere di guasto che non si nota a video.
  const readBoards = () =>
    fs
      .readdirSync(path.join(dataDir, 'boards'))
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(fs.readFileSync(path.join(dataDir, 'boards', f), 'utf-8')))
  const readLibrary = () =>
    JSON.parse(fs.readFileSync(path.join(dataDir, 'library', 'index.json'), 'utf-8'))
  return { app, page, dataDir, readBoards, readLibrary }
}

async function createBoard(page, name) {
  await page.getByRole('button', { name: /Nuova board/ }).click()
  await page.getByPlaceholder('Nome board').fill(name)
  await page.getByRole('button', { name: 'Crea' }).click()
}

module.exports = { launchApp, createBoard }

// Genera gli screenshot per il README lanciando l'app Electron reale su un
// dataset DEMO auto-generato (audio sintetici, gradienti come copertine e
// visual): nessun download, nessun dato personale, output riproducibile.
// Uso: node scripts/screenshots.cjs
// In WSL/CI servono le librerie di sistema di Electron (vedi README).
const path = require('path')
const fs = require('fs')
const os = require('os')
const { execFileSync } = require('child_process')
const { _electron: electron } = require('@playwright/test')

const ROOT = path.join(__dirname, '..')
const OUT = path.join(ROOT, 'docs', 'img')
const FFMPEG = path.join(ROOT, 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------- Dataset demo ----------
function ffmpeg(args) {
  execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args])
}

// Copertina jpg con gradiente (colori esadecimali senza #)
function makeThumb(file, c0, c1) {
  ffmpeg(['-f', 'lavfi', '-i', `gradients=s=640x360:c0=0x${c0}:c1=0x${c1}:x0=0:y0=0:x1=639:y1=359`,
    '-frames:v', '1', file])
}

function makeDemoData(dataDir) {
  const dl = path.join(dataDir, 'library', 'downloaded')
  const th = path.join(dataDir, 'library', 'thumbnails')
  const boards = path.join(dataDir, 'boards')
  for (const d of [dl, th, boards]) fs.mkdirSync(d, { recursive: true })

  // Audio sintetici brevi (bastano per l'UI, non per le orecchie)
  ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=220:duration=4', '-af', 'volume=0.4', path.join(dl, 'svalich.mp3')])
  ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=330:duration=4', '-af', 'volume=0.4', path.join(dl, 'tavern.mp3')])
  ffmpeg(['-f', 'lavfi', '-i', 'anoisesrc=color=pink:duration=4', '-af', 'volume=0.3', path.join(dl, 'forest.mp3')])
  ffmpeg(['-f', 'lavfi', '-i', 'anoisesrc=color=brown:duration=4', '-af', 'volume=0.3', path.join(dl, 'rain.mp3')])
  ffmpeg(['-f', 'lavfi', '-i', 'anoisesrc=color=white:duration=1', '-af', 'volume=0.5', path.join(dl, 'sword.mp3')])
  ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=60:duration=2', '-af', 'volume=0.6', path.join(dl, 'thunder.mp3')])

  // Copertine e visual
  makeThumb(path.join(th, 'svalich.jpg'), '1a1a2e', '0f3460')
  makeThumb(path.join(th, 'tavern.jpg'), '7c2d12', 'f59e0b')
  makeThumb(path.join(th, 'forest.jpg'), '14532d', '22c55e')
  makeThumb(path.join(th, 'rain.jpg'), '1e3a8a', '60a5fa')
  makeThumb(path.join(dl, 'barovia-map.jpg'), '78350f', 'd6b370')
  makeThumb(path.join(th, 'castle.jpg'), '2e1065', 'a855f7')
  // Visual video: gradiente animato 2s, H.264 (stesso profilo dei download reali)
  ffmpeg(['-f', 'lavfi', '-i', 'gradients=s=640x360:d=2:speed=0.2:c0=0x2e1065:c1=0xa855f7',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(dl, 'castle.mp4')])

  const T = (id, title, type, file, thumb, extra = {}) => ({
    id, version: 1, title, type, volume: 0.7,
    ...(type === 'visual'
      ? { mediaPath: `library/downloaded/${file}` }
      : { audioPath: `library/downloaded/${file}` }),
    thumbnailPath: thumb ? `library/thumbnails/${thumb}` : null,
    source: { type: 'local' },
    ...extra
  })
  fs.writeFileSync(path.join(dataDir, 'library', 'index.json'), JSON.stringify({
    version: 1,
    tracks: [
      T('demo_svalich', 'Old Svalich Road — dark ambient loop (1h)', 'music', 'svalich.mp3', 'svalich.jpg'),
      T('demo_tavern', 'The Blue Water Inn — tavern songs', 'music', 'tavern.mp3', 'tavern.jpg'),
      T('demo_forest', 'Svalich Woods — night crickets', 'ambience', 'forest.mp3', 'forest.jpg'),
      T('demo_rain', 'Heavy rain on the roof', 'ambience', 'rain.mp3', 'rain.jpg'),
      T('demo_sword', 'Sword clash', 'oneshot', 'sword.mp3', null),
      T('demo_thunder', 'Thunder strike', 'oneshot', 'thunder.mp3', null),
      T('demo_map', 'Mappa di Barovia', 'visual', 'barovia-map.jpg', null),
      T('demo_castle', 'Castle Ravenloft — storm (video)', 'visual', 'castle.mp4', 'castle.jpg')
    ]
  }, null, 2))

  const B = (label, trackId, visualId, row, col, rowSpan = 2, colSpan = 3) =>
    ({ id: 'b_' + label.toLowerCase().replace(/\W+/g, ''), label, trackId, visualId, row, col, rowSpan, colSpan })
  // 8 bottoni 2x3 su griglia 4x12: la board riempie tutta la finestra
  fs.writeFileSync(path.join(boards, 'demo.json'), JSON.stringify({
    version: 1, id: 'barovia-session', name: 'Barovia — Sessione 12', rows: 4, cols: 12,
    buttons: [
      B('Old Svalich Road', 'demo_svalich', null, 1, 1),
      B('Blue Water Inn', 'demo_tavern', null, 1, 4),
      B('Castle Ravenloft', 'demo_svalich', 'demo_castle', 1, 7),
      B('Mappa di Barovia', null, 'demo_map', 1, 10),
      B('Svalich Woods', 'demo_forest', null, 3, 1),
      B('Pioggia', 'demo_rain', null, 3, 4),
      B('Sword Clash', 'demo_sword', null, 3, 7),
      B('Tuono', 'demo_thunder', null, 3, 10)
    ]
  }, null, 2))

  // Builtin vuoti: niente tracce "file mancante" estranee negli screenshot
  const builtinFile = path.join(dataDir, 'builtin-tracks.json')
  fs.writeFileSync(builtinFile, JSON.stringify({ version: 1, tracks: [] }))

  // Un Chromecast "selezionato" così la toolbar mostra il picker popolato
  fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({
    version: 1, masterVolume: 0.8, musicTransition: 'crossfade', transitionDuration: 3000,
    castDeviceHost: '192.168.1.42', castDeviceName: 'TV Soggiorno'
  }, null, 2))

  return { builtinFile }
}

// ---------- Screenshot ----------
;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-demo-'))
  const { builtinFile } = makeDemoData(dataDir)
  console.log('demo data:', dataDir)

  // SB_EMOJI_FONT_DIR: dir contenente un font emoji (es. NotoColorEmoji.ttf)
  // per ambienti minimali (WSL/CI) dove 📺/🎬 renderizzano come tofu.
  // Config fontconfig temporanea che aggiunge quella dir: nessuna
  // installazione di sistema.
  const env = {
    ...process.env,
    SOUNDBOARD_DATA_DIR: dataDir,
    SOUNDBOARD_BUILTIN_TRACKS: builtinFile
  }
  if (process.env.SB_EMOJI_FONT_DIR) {
    const fcDir = path.join(dataDir, 'fontconfig')
    fs.mkdirSync(path.join(fcDir, 'cache'), { recursive: true })
    const fcFile = path.join(fcDir, 'fonts.conf')
    fs.writeFileSync(fcFile, `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>${process.env.SB_EMOJI_FONT_DIR}</dir>
  <cachedir>${path.join(fcDir, 'cache')}</cachedir>
  <include ignore_missing="yes">/etc/fonts/fonts.conf</include>
</fontconfig>
`)
    env.FONTCONFIG_FILE = fcFile
  }

  const app = await electron.launch({
    args: [path.join(ROOT, 'electron', 'main.js')],
    env
  })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1400, height: 900 })
  await page.waitForSelector('.toolbar')
  await sleep(1500) // caricamento board + thumbnail

  // 1) Play mode — prova ad attivare musica e ambience per i bordi colorati
  //    (in ambienti senza audio il click può non attivare nulla: best effort)
  try {
    await page.locator('.sound-btn', { hasText: 'Old Svalich Road' }).click()
    await sleep(700)
    await page.locator('.sound-btn', { hasText: 'Svalich Woods' }).click()
    await sleep(700)
  } catch { /* best effort */ }
  await page.screenshot({ path: path.join(OUT, 'play-mode.png') })
  console.log('ok play-mode.png')

  // 2) Toolbar (ritaglio) — board switcher, cast picker, master, stop all
  await page.locator('.toolbar').screenshot({ path: path.join(OUT, 'toolbar.png') })
  console.log('ok toolbar.png')

  // 3) Edit mode — seleziona il bottone-scena per mostrare Traccia + Visual
  await page.getByRole('button', { name: /Edit/ }).click()
  await sleep(600)
  const scene = page.locator('.btn-wrapper', { hasText: 'Castle Ravenloft' })
  if (await scene.count()) {
    await scene.first().click()
    await sleep(400)
  }
  await page.screenshot({ path: path.join(OUT, 'edit-mode.png') })
  console.log('ok edit-mode.png')

  // 4) Sidebar libreria (ritaglio) — sezioni, download YouTube audio/video
  await page.locator('.sidebar').screenshot({ path: path.join(OUT, 'library-sidebar.png') })
  console.log('ok library-sidebar.png')

  // 5) Pannello proprietà (ritaglio) — scena con traccia + visual
  await page.locator('.props').screenshot({ path: path.join(OUT, 'properties-panel.png') })
  console.log('ok properties-panel.png')

  await app.close()
  fs.rmSync(dataDir, { recursive: true, force: true })
  console.log('done')
})().catch((e) => {
  console.error(e)
  process.exit(1)
})

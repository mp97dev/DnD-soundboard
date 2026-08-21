// Avvio del server LAN in una copia isolata, per i test che riguardano il
// browser e non Electron: service worker, cache della shell, traffico HTTP.
//
// Il server si copia in una dir temporanea invece di lanciarlo dal repo perché
// paths.js ricava TUTTO da __dirname — dati, bin e soprattutto la build del
// renderer. Copiandolo, un test può montarsi la sua finta build e sostituirla a
// metà prova, che è esattamente quello che serve per chiedersi «una build nuova
// arriva al browser?» senza toccare dist/ del repo.
const os = require('os')
const fs = require('fs')
const path = require('path')
const net = require('net')
const { spawn } = require('child_process')

const REPO = path.join(__dirname, '..')

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

// index.html minimale con lo stesso aggancio che il server usa per iniettare
// (</head>) e un asset col nome hashato, come quelli di vite.
function fakeBuild(dir, tag) {
  const assets = path.join(dir, 'assets')
  fs.mkdirSync(assets, { recursive: true })
  fs.writeFileSync(path.join(assets, `app-${tag}.js`), `document.title = 'build-${tag}'`)
  fs.writeFileSync(
    path.join(dir, 'index.html'),
    `<!doctype html><html><head><title>attesa</title></head><body>` +
      `<h1 id="build">${tag}</h1><script src="./assets/app-${tag}.js"></script></body></html>`
  )
}

// renderer: 'fake' monta la finta build qui sopra (rimpiazzabile con
// server.setBuild), 'real' copia quella vera di dist/renderer.
async function launchServer({ renderer = 'fake', library = null, settings = { locale: 'it' } } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'soundboard-web-'))
  // Solo quello che serve al server: lib/, viewer.html e i tre file di primo
  // livello. Copiare il repo intero (node_modules compresi) sarebbe lentissimo.
  fs.cpSync(path.join(REPO, 'server'), path.join(tmp, 'server'), { recursive: true })
  // express e ws restano quelli del repo: un link, non una copia da 100 MB
  fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(tmp, 'node_modules'), 'dir')
  // electron/builtin-tracks.json: paths.js lo cerca nel repo copiato
  fs.mkdirSync(path.join(tmp, 'electron'), { recursive: true })
  fs.writeFileSync(path.join(tmp, 'electron', 'builtin-tracks.json'), JSON.stringify({ version: 1, tracks: [] }))

  const rendererDir = path.join(tmp, 'dist', 'renderer')
  fs.mkdirSync(rendererDir, { recursive: true })
  if (renderer === 'real') {
    const built = path.join(REPO, 'dist', 'renderer')
    if (!fs.existsSync(path.join(built, 'index.html'))) {
      throw new Error('dist/renderer manca: esegui `npm run build:renderer` prima dei test')
    }
    fs.cpSync(built, rendererDir, { recursive: true })
  } else {
    fakeBuild(rendererDir, '1')
  }

  const dataDir = path.join(tmp, 'data')
  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify(settings))
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

  const port = await freePort()
  const proc = spawn(process.execPath, [path.join(tmp, 'server', 'index.js')], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', SOUNDBOARD_DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const output = []
  proc.stdout.on('data', (d) => output.push(String(d)))
  proc.stderr.on('data', (d) => output.push(String(d)))

  const url = `http://127.0.0.1:${port}/`
  const deadline = Date.now() + 20000
  for (;;) {
    if (proc.exitCode !== null) throw new Error(`server morto:\n${output.join('')}`)
    try {
      const r = await fetch(url)
      if (r.ok) break
    } catch { /* non ancora in ascolto */ }
    if (Date.now() > deadline) throw new Error(`server non partito:\n${output.join('')}`)
    await new Promise((r) => setTimeout(r, 150))
  }

  return {
    url,
    dataDir,
    readBoards: () =>
      fs
        .readdirSync(path.join(dataDir, 'boards'))
        .filter((f) => f.endsWith('.json'))
        .map((f) => JSON.parse(fs.readFileSync(path.join(dataDir, 'boards', f), 'utf-8'))),
    readSettings: () => JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf-8')),
    readLibrary: () => JSON.parse(fs.readFileSync(path.join(dataDir, 'library', 'index.json'), 'utf-8')),
    // Rimpiazza la build servita: è "l'utente ha aggiornato l'app".
    setBuild: (tag) => fakeBuild(rendererDir, tag),
    close: () => new Promise((resolve) => {
      proc.once('exit', () => {
        fs.rmSync(tmp, { recursive: true, force: true })
        resolve()
      })
      proc.kill()
    })
  }
}

// Il service worker prende il controllo di una pagina solo dal caricamento
// SUCCESSIVO a quello in cui si è installato: senza questo giro, metà dei test
// misurerebbe una pagina che il worker non sta ancora servendo.
async function withServiceWorker(page, url) {
  await page.goto(url, { waitUntil: 'load' })
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload({ waitUntil: 'load' })
  await page.waitForFunction(() => !!navigator.serviceWorker.controller)
}

module.exports = { launchServer, withServiceWorker }

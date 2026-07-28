#!/usr/bin/env node
// Soak test: tiene l'app accesa per ore facendole fare quello che fa una
// sessione vera — cambi traccia, ambience che si accavallano, "Stop All",
// visual sulla TV — e lascia dietro di sé un log analizzabile.
//
//   npm run soak                          # 4 ore sui dati reali installati
//   npm run soak -- --minutes=30          # prova breve
//   npm run soak -- --cast=192.168.1.50   # includi la TV nel giro
//   npm run soak -- --data-dir=/percorso/data --switch=45
//
// Perché serve: i guasti che rovinano una sessione (audio che ammutolisce dopo
// due ore, TV che torna alla home, memoria che cresce) non si riproducono in
// trenta secondi di prova. Questo li aspetta al posto tuo, di notte, e ogni
// azione che compie finisce nello stesso log degli eventi dell'app — così
// `npm run session-report` può metterli in fila.
//
// NB: usa i tuoi dati veri (board e libreria). Il soak si limita a premere i
// bottoni: non rinomina e non cancella niente. L'app però, all'avvio, ri-scarica
// da sola i file della libreria che risultano mancanti (redownloadMissing): se
// la cartella dati ne ha, il primo minuto di soak li ripristina. Se preferisci
// stare tranquillo, copia la cartella dati e passala con --data-dir.
const fs = require('fs')
const os = require('os')
const path = require('path')
const { _electron: electron } = require('@playwright/test')

// ---- Argomenti ----
function parseArgs(argv) {
  const args = { minutes: 240, switch: 90, health: 60, cast: null, dataDir: null }
  for (const a of argv) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a)
    if (!m) continue
    const [, key, value] = m
    if (key === 'minutes' || key === 'switch' || key === 'health') args[key] = Number(value)
    else if (key === 'cast') args.cast = value || null
    else if (key === 'data-dir') args.dataDir = value
    else if (key === 'help') args.help = true
  }
  return args
}

function defaultDataDir() {
  const name = 'DnD Soundboard'
  const home = os.homedir()
  const userData =
    process.platform === 'darwin' ? path.join(home, 'Library', 'Application Support', name)
      : process.platform === 'win32' ? path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), name)
        : path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), name)
  const installed = path.join(userData, 'data')
  return fs.existsSync(path.join(installed, 'library')) ? installed : path.join(__dirname, '..', 'data')
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const hhmm = () => new Date().toISOString().slice(11, 19)
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(fs.readFileSync(__filename, 'utf-8').split('\n').slice(1, 20).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'))
    return
  }
  const dataDir = args.dataDir || defaultDataDir()
  const endAt = Date.now() + args.minutes * 60000

  console.log(`Soak test — ${args.minutes} min, cambio traccia ogni ${args.switch}s`)
  console.log(`Dati:  ${dataDir}`)
  console.log(`Log:   ${path.join(dataDir, 'logs', 'soundboard.log')}`)
  console.log(`Referto a fine corsa:  npm run session-report -- "${path.join(dataDir, 'logs', 'soundboard.log')}"`)
  console.log('')

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    env: {
      ...process.env,
      SOUNDBOARD_DATA_DIR: dataDir,
      // Battito più fitto del minuto di default: un soak deve produrre una
      // serie temporale abbastanza densa da mostrare una tendenza.
      SOUNDBOARD_HEALTH_MS: String(args.health * 1000)
    }
  })
  const page = await app.firstWindow()
  await page.waitForSelector('.sound-btn', { timeout: 30000 })

  // Ogni azione del soak passa dal logger dell'app: azioni ed eventi finiscono
  // nello stesso file, in ordine, ed è l'unico modo per dire "il buco audio è
  // arrivato 12 secondi dopo QUESTO cambio traccia".
  const note = (msg, fields) =>
    page.evaluate(([m, f]) => window.api?.log?.write({ level: 'info', scope: 'soak', msg: m, fields: f }), [msg, fields])
      .catch(() => {})

  if (args.cast) {
    await note('TV richiesta per il soak', { host: args.cast })
    console.log(`${hhmm()}  la TV va selezionata a mano dalla toolbar (host ${args.cast}); il soak userà i bottoni con visual`)
  }

  const buttons = async (kind) =>
    page.locator(kind === 'visual' ? '.sound-btn:has(.cast-badge)' : `.sound-btn:has(.type-dot.${kind})`)

  const music = await buttons('music')
  const ambience = await buttons('ambience')
  const visuals = await buttons('visual')
  const counts = {
    music: await music.count(),
    ambience: await ambience.count(),
    visual: await visuals.count()
  }
  console.log(`${hhmm()}  bottoni trovati: ${counts.music} musica · ${counts.ambience} ambience · ${counts.visual} visual`)
  if (!counts.music && !counts.ambience) {
    console.error('Nessun bottone audio nella board corrente: apri la board che usi in gioco e riprova.')
    await app.close()
    process.exit(1)
  }
  await note('soak avviato', { minuti: args.minutes, ...counts })

  let cycle = 0
  let stopped = false
  const finish = async (reason) => {
    if (stopped) return
    stopped = true
    await note('soak concluso', { motivo: reason, cicli: cycle })
    console.log(`\n${hhmm()}  fine (${reason}) dopo ${cycle} cicli.`)
    console.log(`Referto:  npm run session-report -- "${path.join(dataDir, 'logs', 'soundboard.log')}"`)
    try { await app.close() } catch { /* già chiusa */ }
    process.exit(0)
  }
  process.on('SIGINT', () => finish('interrotto a mano'))

  while (Date.now() < endAt) {
    cycle += 1
    const remainMin = Math.round((endAt - Date.now()) / 60000)

    // 1. Cambio traccia musicale: la transizione più costosa e la più usata
    if (counts.music) {
      const i = Math.floor(Math.random() * counts.music)
      const label = (await music.nth(i).locator('.label').textContent())?.trim()
      await music.nth(i).click()
      await note('cambio musica', { ciclo: cycle, bottone: label })
      console.log(`${hhmm()}  [${cycle}] musica → ${label}   (restano ${remainMin} min)`)
    }

    // 2. Ogni 3 cicli un'ambience si accende o si spegne: le voci simultanee
    //    sono quelle che, quando la cassa sparisce, ricostruiscono tutte insieme
    if (counts.ambience && cycle % 3 === 0) {
      const i = Math.floor(Math.random() * counts.ambience)
      const label = (await ambience.nth(i).locator('.label').textContent())?.trim()
      await ambience.nth(i).click()
      await note('toggle ambience', { ciclo: cycle, bottone: label })
      console.log(`${hhmm()}  [${cycle}] ambience → ${label}`)
    }

    // 3. Ogni 5 cicli un visual: è il caso che fa cadere la TV (immagine ferma
    //    contro video in loop, §3 e §7 del piano di test)
    if (counts.visual && args.cast && cycle % 5 === 0) {
      const i = Math.floor(Math.random() * counts.visual)
      const label = (await visuals.nth(i).locator('.label').textContent())?.trim()
      await visuals.nth(i).click()
      await note('visual sulla TV', { ciclo: cycle, bottone: label })
      console.log(`${hhmm()}  [${cycle}] visual → ${label}`)
    }

    // 4. Ogni 10 cicli "Stop All": ferma tutto e riparte, come a fine scena
    if (cycle % 10 === 0) {
      await page.getByRole('button', { name: /Stop All/ }).click()
      await note('stop all', { ciclo: cycle })
      console.log(`${hhmm()}  [${cycle}] stop all`)
      await sleep(3000)
    }

    // Attesa fino al prossimo cambio, ma senza sforare la fine
    const wait = Math.min(args.switch * 1000, Math.max(0, endAt - Date.now()))
    await sleep(wait)
  }

  await finish('durata raggiunta')
}

main().catch(async (err) => {
  console.error('Soak interrotto da un errore:', err.message)
  process.exit(1)
})

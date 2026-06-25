// Genera gli screenshot per il README lanciando l'app Electron reale sui dati
// esistenti (board Curse of Strahd con tracce + thumbnail veri).
// Uso (in WSL con node 24): node scripts/screenshots.cjs
const path = require('path')
const fs = require('fs')
const { _electron: electron } = require('@playwright/test')

const ROOT = path.join(__dirname, '..')
const OUT = path.join(ROOT, 'docs', 'img')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

;(async () => {
  fs.mkdirSync(OUT, { recursive: true })

  const app = await electron.launch({
    args: [path.join(ROOT, 'electron', 'main.js')],
    env: {
      ...process.env,
      SOUNDBOARD_DATA_DIR: path.join(ROOT, 'data'),
      SOUNDBOARD_BUILTIN_TRACKS: path.join(ROOT, 'electron', 'builtin-tracks.json')
    }
  })
  const page = await app.firstWindow()
  await page.waitForSelector('.toolbar')
  await sleep(1200) // attende il caricamento di board + thumbnail

  // 1) Play mode (default) — vista da sessione
  await sleep(400)
  await page.screenshot({ path: path.join(OUT, 'play-mode.png') })
  console.log('ok play-mode.png')

  // 2) Edit mode — sidebar libreria + griglia + pannello proprietà
  await page.getByRole('button', { name: /Edit/ }).click()
  await sleep(600)
  const firstBtn = page.locator('.btn-wrapper').first()
  if (await firstBtn.count()) {
    await firstBtn.click() // seleziona -> mostra PropertiesPanel
    await sleep(400)
  }
  await page.screenshot({ path: path.join(OUT, 'edit-mode.png') })
  console.log('ok edit-mode.png')

  // 3) Sidebar libreria (ritaglio) — box download YouTube + elenco tracce
  const sidebar = page.locator('.sidebar')
  if (await sidebar.count()) {
    await sidebar.screenshot({ path: path.join(OUT, 'library-sidebar.png') })
    console.log('ok library-sidebar.png')
  }

  await app.close()
  console.log('done')
})().catch((e) => {
  console.error(e)
  process.exit(1)
})

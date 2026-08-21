// Esportazione del log e rimpicciolimento delle copertine.
//
// Il log serve solo se chi ha visto il guasto riesce a mandarlo: installato dal
// .deb finisce in ~/.config/dnd-soundboard/data/logs/, che nessuno trova per
// caso. Queste prove coprono le due strade — la rotta HTTP (browser/tablet) e
// il bottone — e il fatto che dentro ci sia davvero la sessione intera.
const { test, expect } = require('@playwright/test')
const fs = require('fs')
const path = require('path')
const { launchServer } = require('./web-helpers')
const { shrinkAll, jpegSize, TARGET_WIDTH } = require('../server/lib/thumbnails')

test('log: la rotta di esportazione dà un file scaricabile con dentro la sessione', async ({ browser }) => {
  const server = await launchServer({ renderer: 'real' })
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.goto(server.url, { waitUntil: 'load' })
  await page.waitForSelector('.toolbar')

  const res = await page.request.get(`${server.url}api/logs/export`)
  expect(res.status()).toBe(200)
  expect(res.headers()['content-disposition']).toMatch(/attachment; filename="soundboard-log-\d{4}-\d{2}-\d{2}_\d{6}\.txt"/)
  const text = await res.text()

  // L'avvio del server e l'ambiente: è la parte che dice su che macchina
  // girava, ed è la prima a sparire se si esporta solo il file corrente.
  expect(text).toContain('app avvio')
  expect(text).toMatch(/env sistema .*cpuCount=/)
  // E le righe del renderer, che arrivano per POST /api/log
  await expect.poll(async () => (await (await page.request.get(`${server.url}api/logs/export`)).text()))
    .toMatch(/ui:health ambiente renderer .*cpuLogiche=/)

  await ctx.close()
  await server.close()
})

test('log: il bottone 🩺 scarica il log dal browser', async ({ browser }) => {
  const server = await launchServer({ renderer: 'real' })
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, acceptDownloads: true })
  const page = await ctx.newPage()
  await page.goto(server.url, { waitUntil: 'load' })
  await page.waitForSelector('.toolbar')

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('.toolbar button.icon-only').click()
  ])
  expect(download.suggestedFilename()).toMatch(/^soundboard-log-/)
  const file = await download.path()
  expect(fs.readFileSync(file, 'utf-8')).toContain('app avvio')

  // La pagina non se ne va: scaricare non deve interrompere la sessione in corso
  await expect(page.locator('.toolbar')).toBeVisible()

  await ctx.close()
  await server.close()
})

test('log: l\'esportazione include anche il file ruotato, in ordine di tempo', () => {
  // Non si può far ruotare un log da 2 MB in un test ragionevole: si prepara la
  // coppia di file a mano e si chiede al modulo di leggerla, che è la parte che
  // può sbagliare l'ordine.
  const log = require('../server/lib/log')
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'soundboard-logexp-'))
  log.init(tmp)
  const dir = path.join(tmp, 'logs')
  fs.writeFileSync(path.join(dir, 'soundboard.log.1'), 'RIGA VECCHIA\n')
  fs.writeFileSync(path.join(dir, 'soundboard.log'), 'RIGA NUOVA\n')

  const text = log.exportText()
  expect(text).toContain('RIGA VECCHIA')
  expect(text).toContain('RIGA NUOVA')
  expect(text.indexOf('RIGA VECCHIA')).toBeLessThan(text.indexOf('RIGA NUOVA'))
  expect(log.logPath()).toBe(path.join(dir, 'soundboard.log'))

  fs.rmSync(tmp, { recursive: true, force: true })
})

test('copertine: 1280x720 diventano 480, e la seconda passata non tocca niente', async () => {
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'soundboard-thumbs-'))
  const src = path.join(__dirname, '..', 'data', 'library', 'thumbnails')
  const big = fs.existsSync(src) && fs.readdirSync(src).filter((f) => f.endsWith('.jpg'))
  test.skip(!big || !big.length, 'nessuna copertina di esempio in data/library/thumbnails')

  for (const f of big.slice(0, 3)) fs.copyFileSync(path.join(src, f), path.join(tmp, f))
  const sizeOf = (f) => jpegSize(fs.readFileSync(path.join(tmp, f)).subarray(0, 65536))

  const first = await shrinkAll(tmp, 'ffmpeg')
  test.skip(first.ridotte === 0, 'ffmpeg non disponibile su questa macchina')
  expect(first.ridotte).toBe(first.esaminate)
  for (const f of fs.readdirSync(tmp)) expect(sizeOf(f).width).toBe(TARGET_WIDTH)
  // Il guadagno che conta è la bitmap decodificata, non il file su disco
  expect(first.pixelRisparmiatiMB).toBeGreaterThan(0)

  const second = await shrinkAll(tmp, 'ffmpeg')
  expect(second.ridotte).toBe(0)
  expect(second.esaminate).toBe(first.esaminate)

  fs.rmSync(tmp, { recursive: true, force: true })
})

test('copertine: un file che non è un jpeg non viene toccato', async () => {
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'soundboard-thumbs-'))
  const fake = path.join(tmp, 'rotta.jpg')
  fs.writeFileSync(fake, 'questo non è un jpeg')
  const out = await shrinkAll(tmp, 'ffmpeg')
  expect(out.ridotte).toBe(0)
  expect(fs.readFileSync(fake, 'utf-8')).toBe('questo non è un jpeg')
  fs.rmSync(tmp, { recursive: true, force: true })
})

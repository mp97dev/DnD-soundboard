// Il renderer servito nel browser (modalità server LAN / tablet).
// Qui vivono i guasti che Electron non può avere: il service worker e il
// traffico HTTP verso il server.
const { test, expect } = require('@playwright/test')
const { launchServer, withServiceWorker } = require('./web-helpers')

const tracks = [
  {
    id: 't1', version: 1, title: 'Taverna', type: 'music', volume: 0.5,
    audioPath: 'library/downloaded/t1.mp3', thumbnailPath: null,
    tags: [], folderIds: [], source: { type: 'local' }
  }
]

// Regressione del guasto peggiore trovato in modalità browser: il service
// worker teneva la shell in cache-first, e la shell è l'unico file che nomina
// gli asset (che hanno l'hash nel nome). Una shell vecchia in cache = asset
// vecchi per sempre. Un Brave aperto a luglio serviva ancora il renderer di
// luglio a fine agosto: ricompilare non bastava, ricaricare non bastava, e
// nemmeno Ctrl+Shift+R — a rispondere non era più la rete.
test('service worker: una build nuova arriva al browser', async ({ browser }) => {
  const server = await launchServer()
  const ctx = await browser.newContext()
  const page = await ctx.newPage()

  await withServiceWorker(page, server.url)
  await expect(page.locator('#build')).toHaveText('1')

  server.setBuild('2')
  await page.reload({ waitUntil: 'load' })
  await expect(page.locator('#build')).toHaveText('2')

  // e l'asset servito è quello nuovo, non solo la shell
  await expect.poll(() => page.title()).toBe('build-2')

  await ctx.close()
  await server.close()
})

// Il motivo per cui il service worker esiste comunque: la shell resta
// disponibile senza rete. Togliere la cache-first della shell non deve aver
// buttato via anche questo.
test('service worker: senza rete la shell si apre lo stesso', async ({ browser }) => {
  const server = await launchServer()
  const ctx = await browser.newContext()
  const page = await ctx.newPage()

  await withServiceWorker(page, server.url)
  await expect(page.locator('#build')).toHaveText('1')

  await ctx.setOffline(true)
  await page.reload({ waitUntil: 'load' })
  await expect(page.locator('#build')).toHaveText('1')

  await ctx.setOffline(false)
  await ctx.close()
  await server.close()
})

// La shell non deve poter restare appesa nemmeno nella cache HTTP, che è
// l'altro strato capace di inchiodare il browser a una build vecchia.
test('la shell si rivalida sempre, gli asset no', async ({ browser }) => {
  const server = await launchServer()
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.goto(server.url, { waitUntil: 'load' })

  const head = async (p) => (await page.request.get(server.url.replace(/\/$/, '') + p)).headers()['cache-control']
  expect(await head('/')).toContain('no-cache')
  expect(await head('/sw.js')).toContain('no-cache')
  expect(await head('/web-api.js')).toContain('no-cache')
  expect(await head('/assets/app-1.js')).toContain('immutable')

  await ctx.close()
  await server.close()
})

// Regressione delle scritture a raffica. Gli @input dell'interfaccia sono
// continui, i salvataggi no: una trascinata sola dello slider produceva 39 POST
// (una riscrittura completa del file per ciascuno), partiti tutti insieme e
// quindi senza ordine garantito — si lasciava lo slider al 30% e si riapriva
// l'app a un valore preso a caso lungo la strada.
test('una trascinata dello slider non è una raffica di scritture', async ({ browser }) => {
  const server = await launchServer({ renderer: 'real', library: { tracks } })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await ctx.newPage()
  await page.goto(server.url, { waitUntil: 'load' })
  await page.waitForSelector('.toolbar')

  const posts = []
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('/api/settings')) posts.push(r.url())
  })

  const slider = page.locator('.master input[type=range]')
  const box = await slider.boundingBox()
  const y = box.y + box.height / 2
  await page.mouse.move(box.x + 5, y)
  await page.mouse.down()
  // avanti fino in fondo e poi indietro: se le scritture si sorpassassero, su
  // disco resterebbe uno dei valori alti attraversati per strada
  for (let i = 0; i <= 30; i++) await page.mouse.move(box.x + 5 + (box.width - 10) * (i / 30), y)
  for (let i = 30; i >= 5; i--) await page.mouse.move(box.x + 5 + (box.width - 10) * (i / 30), y)
  await page.mouse.up()

  const shown = await slider.inputValue()
  // Poche, non zero: durante una trascinata lunga si scrive comunque ogni
  // tanto, così una chiusura brutale a metà gesto non perde tutto.
  await expect.poll(() => posts.length, { timeout: 3000 }).toBeLessThan(10)
  await expect.poll(() => String(server.readSettings().masterVolume)).toBe(shown)

  await ctx.close()
  await server.close()
})

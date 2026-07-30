// L'editor inline della libreria (rinomina + tag) tiene tutto in uno stato solo:
// questo test lo apre, lo compila e lo salva davvero, perché il resto della
// suite non passa mai di qui.
const { test, expect } = require('@playwright/test')
const { launchApp, createBoard } = require('./helpers')

test('libreria: rinomina e tag dall\'editor inline', async () => {
  const { app, page } = await launchApp()
  await createBoard(page, 'Test')
  await page.getByRole('button', { name: /Edit/ }).click()

  // Una traccia in libreria: la scarica il finto yt-dlp
  await page.getByPlaceholder('URL o playlist YouTube').fill('https://youtu.be/dQw4w9WgXcQ')
  await page.getByRole('button', { name: 'Scarica audio da YouTube' }).click()
  await expect(page.locator('.track .title')).toHaveText('Test Track', { timeout: 20_000 })

  // I bottoni di riga compaiono all'hover
  await page.locator('.track').first().hover()
  await page.getByTitle('Rinomina / tag').first().click()
  await page.getByPlaceholder('Titolo').fill('Taverna del Drago')
  const tagField = page.getByPlaceholder('+ tag')
  await tagField.fill('taverna')
  await tagField.press('Enter')
  await expect(page.locator('.tag-chip.editing')).toHaveText([/^taverna/])
  // Un tag ancora nel campo al momento del salvataggio fa parte del salvataggio
  await tagField.fill('allegro')
  await page.getByRole('button', { name: 'Salva' }).click()

  await expect(page.locator('.track .title')).toHaveText('Taverna del Drago')
  await expect(page.getByPlaceholder('Titolo')).toHaveCount(0) // editor chiuso
  // I tag salvati compaiono fra i chip di filtro
  await expect(page.locator('.tag-filters .tag-chip')).toHaveText(['allegro', 'taverna'])

  // Riaperto, l'editor riparte dai valori salvati e con il campo tag vuoto
  await page.locator('.track').first().hover()
  await page.getByTitle('Rinomina / tag').first().click()
  await expect(page.getByPlaceholder('Titolo')).toHaveValue('Taverna del Drago')
  await expect(page.getByPlaceholder('+ tag')).toHaveValue('')
  await expect(page.locator('.tag-chip.editing')).toHaveText([/^taverna/, /^allegro/])

  // Annulla non salva e chiude l'editor
  await page.getByPlaceholder('Titolo').fill('Nome buttato via')
  await page.getByRole('button', { name: 'Annulla' }).click()
  await expect(page.getByPlaceholder('Titolo')).toHaveCount(0)
  await expect(page.locator('.track .title')).toHaveText('Taverna del Drago')

  await app.close()
})

// Regressione dell'hotfix 1.0.3: con parecchie cartelle i blocchi fissi della
// sidebar si prendevano tutta l'altezza e la lista delle tracce veniva
// schiacciata a zero. Nessuna traccia a schermo e niente da scorrere.
test('libreria: con molte cartelle la lista tracce resta raggiungibile', async () => {
  const folders = Array.from({ length: 10 }, (_, i) => ({
    id: `f${i}`, name: `Campagna ${i + 1}`, parentId: null, color: null
  }))
  const tracks = Array.from({ length: 25 }, (_, i) => ({
    id: `t${i}`, version: 1, title: `Traccia numero ${i + 1}`, type: 'music',
    volume: 1, audioPath: `library/downloaded/${i}.mp3`, thumbnailPath: null,
    tags: [], folderIds: [], source: { type: 'local' }
  }))
  const { app, page } = await launchApp({ library: { folders, tracks } })
  await page.setViewportSize({ width: 1024, height: 640 })
  await createBoard(page, 'Test')
  await page.getByRole('button', { name: /Edit/ }).click()
  await page.waitForSelector('.sidebar')

  // La lista non è schiacciata a zero...
  const sections = page.locator('.sections')
  await expect(sections).toBeVisible()
  expect((await sections.boundingBox()).height).toBeGreaterThan(100)

  // ...e l'ultima traccia si raggiunge davvero scorrendo
  const last = page.locator('.sidebar .track', { hasText: 'Traccia numero 25' }).first()
  await last.scrollIntoViewIfNeeded()
  await expect(last).toBeInViewport()

  // La maniglia di ridimensionamento non se ne va con lo scorrimento: sta
  // fuori dal contenitore che scorre, ed è tutto il motivo per cui esiste.
  const handle = await page.locator('.resize-handle').boundingBox()
  const side = await page.locator('.sidebar').boundingBox()
  expect(Math.abs(handle.y - side.y)).toBeLessThan(2)

  await app.close()
})

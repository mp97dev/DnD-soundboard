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

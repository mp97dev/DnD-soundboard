const { test, expect } = require('@playwright/test')
const { launchApp, createBoard } = require('./helpers')

test('avvio: finestra ed empty state', async () => {
  const { app, page } = await launchApp()
  await expect(page.locator('.logo')).toContainText('Soundboard')
  await expect(page.locator('.empty')).toContainText('Nessuna board')
  await app.close()
})

test('creazione board e switch modalità', async () => {
  const { app, page } = await launchApp()
  await createBoard(page, 'Sessione Test')

  await expect(page.locator('.empty')).toHaveCount(0)
  await expect(page.locator('select')).toHaveValue(/sessione-test/)

  await page.getByRole('button', { name: /Edit/ }).click()
  await expect(page.getByPlaceholder('URL o playlist YouTube')).toBeVisible()

  await page.getByRole('button', { name: /Play/ }).click()
  await expect(page.getByPlaceholder('URL o playlist YouTube')).toHaveCount(0)

  await app.close()
})

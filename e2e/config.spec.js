const os = require('os')
const path = require('path')
const fs = require('fs')
const { test, expect } = require('@playwright/test')
const { launchApp, createBoard } = require('./helpers')

// I dialog nativi (save/open) vengono stubbati nel main process verso un
// percorso fisso, così il round-trip è interamente automatizzabile.
test('export/import: round-trip di board tra istanze diverse', async () => {
  const exportPath = path.join(os.tmpdir(), `sb-export-${Date.now()}.json`)

  // ---- Istanza A: crea una board ed esporta ----
  const a = await launchApp()
  await createBoard(a.page, 'My Board')
  await a.app.evaluate(({ dialog }, fp) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: fp })
  }, exportPath)
  await a.page.getByRole('button', { name: /Esporta/ }).click()
  await expect(a.page.locator('.io-msg')).toContainText('esportata')
  await a.app.close()

  expect(fs.existsSync(exportPath)).toBe(true)
  const bundle = JSON.parse(fs.readFileSync(exportPath, 'utf-8'))
  expect(bundle.type).toBe('dnd-soundboard-export')
  expect(bundle.boards.map((b) => b.name)).toContain('My Board')

  // ---- Istanza B (dati vuoti): importa lo stesso file ----
  const b = await launchApp()
  await expect(b.page.locator('.empty')).toContainText('Nessuna board')
  await b.app.evaluate(({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] })
  }, exportPath)
  await b.page.getByRole('button', { name: /Importa/ }).click()

  // La board importata compare nel selettore
  await expect(b.page.locator('select.board-select')).toHaveValue(/my-board/, { timeout: 10_000 })
  await expect(b.page.locator('.io-msg')).toContainText('Importate')
  await b.app.close()

  fs.rmSync(exportPath, { force: true })
})

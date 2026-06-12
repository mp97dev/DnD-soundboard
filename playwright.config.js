const { defineConfig } = require('@playwright/test')

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  // Un'istanza Electron alla volta: più stabile e i test sono pochi
  workers: 1,
  reporter: [['list']]
})

import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  // Cada teste sobe um Electron; paralelizar briga por CPU e deixa o Monaco lento.
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0
})

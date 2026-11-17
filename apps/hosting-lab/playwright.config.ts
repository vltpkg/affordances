import { defineConfig } from '@playwright/test'

// E2E_PORT when something else already holds 3007 (reuseExistingServer would test that instead)
const port = Number(process.env.E2E_PORT ?? 3007)

export default defineConfig({
  testDir: 'e2e',
  // one server, one in-memory store
  workers: 1,
  forbidOnly: !!process.env.CI,
  use: {
    baseURL: `http://localhost:${port}`,
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH },
  },
  webServer: {
    command: `node_modules/.bin/next build && node_modules/.bin/next start -p ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})

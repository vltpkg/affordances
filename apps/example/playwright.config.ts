import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { defineConfig } from '@playwright/test'

// @playwright/test 1.64 expects a chromium revision this machine hasn't downloaded, so use the cached
// headless shell (rev 1237) when it's there. Elsewhere, set PLAYWRIGHT_CHROMIUM_PATH, or run
// `playwright install chromium` and Playwright finds its own.
const cached = `${homedir()}/Library/Caches/ms-playwright/chromium_headless_shell-1237/chrome-headless-shell-mac-arm64/chrome-headless-shell`
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_PATH ?? (existsSync(cached) ? cached : undefined)

// E2E_PORT when something else already holds 3001 (reuseExistingServer would test that instead)
const port = Number(process.env.E2E_PORT ?? 3001)

export default defineConfig({
  testDir: 'e2e',
  // one server, one in-memory store: run serially so stock and orders don't race
  workers: 1,
  forbidOnly: !!process.env.CI,
  use: { baseURL: `http://localhost:${port}`, launchOptions: { executablePath } },
  webServer: {
    command: `node_modules/.bin/next build && node_modules/.bin/next start -p ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})

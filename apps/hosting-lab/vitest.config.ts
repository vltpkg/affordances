import { defineConfig } from 'vitest/config'

// unit tests only: e2e/ is Playwright's (test:e2e), and needs a running app
export default defineConfig({ test: { include: ['test/**/*.test.ts'] } })

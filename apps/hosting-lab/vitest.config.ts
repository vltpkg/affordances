import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// unit tests only: e2e/ is Playwright's (test:e2e), and needs a running app. `@` is the app's own alias
// (tsconfig.json), so a test can load the app's real state loaders
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // .tsx too: a component's rendering is tested with react-dom/server
  test: { include: ['test/**/*.test.{ts,tsx}'] },
})

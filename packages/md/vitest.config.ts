import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // the routes the app's alias would give the handler: a module the tests fill in, without building dist first
  resolve: {
    alias: {
      '@affordances/md/routes': fileURLToPath(new URL('test/markdown-routes.ts', import.meta.url)),
    },
  },
})

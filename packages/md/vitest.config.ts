import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// the routes the app's alias would give the handler: a module the tests fill in, without building dist first
const alias = {
  '@affordances/md/routes': fileURLToPath(new URL('test/markdown-routes.ts', import.meta.url)),
}

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      { resolve: { alias }, test: { name: 'core', setupFiles: ['test/core-path.ts'] } },
      // the same suite on the tree pipeline; md-core's own tests choose their paths, so they run once
      {
        resolve: { alias },
        test: {
          name: 'tree',
          setupFiles: ['test/tree-path.ts'],
          exclude: ['test/convert/core/**', '**/node_modules/**'],
        },
      },
    ],
  },
})

import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// M7b's golden v0 check (README.md beside this): apps/example's own `@` alias, and this directory's one test
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)) },
  },
  test: {
    include: [fileURLToPath(new URL('./golden.test.ts', import.meta.url))],
    root: fileURLToPath(new URL('../..', import.meta.url)),
  },
})

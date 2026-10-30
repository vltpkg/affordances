import { defineConfig } from 'tsdown'

// shared by every package: `tsdown` runs from the package dir and finds this via its own tsdown.config.ts
export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  platform: 'neutral',
  dts: true,
  clean: true,
  // .js + .d.ts: every package is type: module
  fixedExtension: false,
})

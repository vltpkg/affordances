import { defineConfig } from 'tsdown'
import base from '../../tsdown.config.ts'

export default defineConfig({
  ...base,
  entry: ['src/index.ts', 'src/config.ts', 'src/route.ts', 'src/manifest.ts', 'src/codegen.ts'],
  // the route handler's manifest import stays a package import, so the app's alias can replace it
  external: ['@affordances/next/manifest'],
  platform: 'node',
})

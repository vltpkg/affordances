import { defineConfig } from 'tsdown'
import base from '../../tsdown.config.ts'

export default defineConfig({
  ...base,
  entry: [
    'src/index.ts',
    'src/config.ts',
    'src/route.ts',
    'src/manifest.ts',
    'src/codegen.ts',
    'src/diagnostics.ts',
  ],
  // the route handler's manifest import stays a package import, so the app's alias can replace it
  external: ['@affordances/next/manifest'],
  platform: 'node',
  // the build's own tsconfig, src only: tsconfig.json also includes test/, and a test importing another package's
  // source (extract.test.ts reads ir's schema) would otherwise have its declarations written into that package's src
  tsconfig: 'tsconfig.build.json',
})

import { defineConfig } from 'tsdown'
import base from '../../tsdown.config.ts'

export default defineConfig([
  {
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
  },
  // the capability-module evaluator's child program (RFC 0005 §1), run by path, never imported: so no declarations.
  // @affordances/ir is next's optional peer, so tsdown keeps it external, a bare import the app resolves (intake,
  // 2026-11-18); nothing of ir or zod is bundled. Built after the main entries, without cleaning their output
  {
    ...base,
    entry: ['src/evaluate.ts'],
    platform: 'node',
    dts: false,
    clean: false,
    tsconfig: 'tsconfig.build.json',
  },
])

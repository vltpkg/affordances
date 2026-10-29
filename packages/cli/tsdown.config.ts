import { defineConfig } from 'tsdown'
import base from '../../tsdown.config.ts'

export default defineConfig({
  ...base,
  entry: ['src/cli.ts'],
  platform: 'node',
  dts: false,
  // effect is bundled, not installed: it unpacks to ~56 MB, and `vlx @affordances/cli` should start fast
  noExternal: ['effect', /^effect\//, '@effect/platform-node', /^@effect\/platform-node\//],
})

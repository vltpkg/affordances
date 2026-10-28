import { defineConfig } from 'tsdown'
import base from '../../tsdown.config.ts'

export default defineConfig({
  ...base,
  entry: ['src/index.ts', 'src/config.ts', 'src/route.ts', 'src/cli.ts'],
  platform: 'node',
})

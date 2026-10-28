import { defineConfig } from 'tsdown'
import base from '../../tsdown.config.ts'

// one file per module, so provider.tsx keeps its 'use client' directive
export default defineConfig({
  ...base,
  entry: ['src/index.ts', 'src/dev.tsx'],
  unbundle: true,
  platform: 'browser',
})

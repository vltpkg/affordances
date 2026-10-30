import { defineConfig } from 'tsdown'
import base from '../../tsdown.config.ts'

export default defineConfig({
  ...base,
  entry: {
    index: 'src/index.ts',
    react: 'src/react/index.ts',
    next: 'src/next/index.ts',
    'next-llms': 'src/next/llms.ts',
    'next-llms-full': 'src/next/llms-full.ts',
    cli: 'src/cli.ts',
  },
})

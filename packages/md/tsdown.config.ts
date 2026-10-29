import { defineConfig } from 'tsdown'
import base from '../../tsdown.config.ts'

export default defineConfig({
  ...base,
  entry: {
    index: 'src/index.ts',
    react: 'src/react/index.ts',
    next: 'src/next/index.ts',
    cli: 'src/cli.ts',
  },
})

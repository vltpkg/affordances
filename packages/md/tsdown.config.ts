import { defineConfig } from 'tsdown'
import base from '../../tsdown.config.ts'

export default defineConfig({
  ...base,
  entry: {
    index: 'src/index.ts',
    react: 'src/react/index.ts',
    'react-client': 'src/react/client.ts',
    next: 'src/next/index.ts',
    'next-llms': 'src/next/llms.ts',
    'next-llms-full': 'src/next/llms-full.ts',
    'next-proxy': 'src/next/proxy.ts',
    cli: 'src/cli.ts',
    routes: 'src/next/markdown-routes.ts',
  },
  // the handler's routes import stays a package import, so the app's alias can replace it
  external: ['@affordances/md/routes'],
})

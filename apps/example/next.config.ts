import { withAffordances } from '@affordances/next/config'
import { md } from '@affordances/md/next'
import path from 'node:path'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactCompiler: true,
  // CodeBlock highlights under 'use cache'
  cacheComponents: true,
  partialPrefetching: true,
  transpilePackages: ['@affordances/ui'],
  // vlt-lock.json sits at the repo root, and next resolves `next` (and @affordances/ui) from there
  turbopack: { root: path.join(import.meta.dirname, '../..') },
}

export default withAffordances(nextConfig, { name: 'Afford Supply', plugins: [md()] })

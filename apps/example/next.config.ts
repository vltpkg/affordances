import path from 'node:path'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactCompiler: true,
  // CodeBlock highlights under 'use cache'
  cacheComponents: true,
  partialPrefetching: true,
  transpilePackages: ['@afford/ui'],
  // vlt-lock.json sits at the repo root, and next resolves `next` (and @afford/ui) from there
  turbopack: { root: path.join(import.meta.dirname, '../..') },
}

export default nextConfig

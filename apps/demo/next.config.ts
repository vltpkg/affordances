import path from 'node:path'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactCompiler: true,
  transpilePackages: ['@affordances/ui'],
  // vlt-lock.json sits at the repo root, and next resolves `next` (and @affordances/ui) from there
  turbopack: { root: path.join(import.meta.dirname, '../..') },
}

export default nextConfig

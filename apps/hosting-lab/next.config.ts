import { withAffordances } from '@affordances/next/config'
import path from 'node:path'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  transpilePackages: ['@affordances/ui'],
  // vlt-lock.json sits at the repo root, and next resolves `next` (and @affordances/ui) from there
  turbopack: { root: path.join(import.meta.dirname, '../..') },
}

export default withAffordances(nextConfig, { name: 'Hosting Lab' })

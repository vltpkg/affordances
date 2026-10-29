import path from 'node:path'
import { createMDX } from 'fumadocs-mdx/next'
import { md } from '@afford/md/next'
import { withAfford } from '@afford/next/config'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactCompiler: true,
  cacheComponents: true,
  partialPrefetching: true,
  transpilePackages: ['@afford/ui'],
  // vlt-lock.json sits at the repo root, and next resolves `next` (and @afford/ui) from there
  turbopack: { root: path.join(import.meta.dirname, '../..') },
}

// the graph for agents that speak afford, and markdown (`/page.md`, `Accept: text/markdown`) for the rest;
// each plugin's rewrites match only its own media type, so they don't collide
export default createMDX()(withAfford(nextConfig, { name: 'Afford docs', plugins: [md()] }))

import path from 'node:path'
import { createMDX } from 'fumadocs-mdx/next'
import { withAfford } from '@afford/next/config'
import type { NextConfig } from 'next'

const acceptsMarkdown = { type: 'header', key: 'accept', value: '.*text/markdown.*' } as const

// extensionless pages; skips the markdown route, afford's handler, and anything with a file extension
// (`.md` urls, llms.txt, sitemap.xml), which has no markdown twin
const pages = '/:path((?!llms\\.mdx/)(?!api/)(?!.*\\.[a-z0-9]+$).+)'

const nextConfig: NextConfig = {
  reactCompiler: true,
  cacheComponents: true,
  partialPrefetching: true,
  transpilePackages: ['@afford/ui'],
  // withAfford's graph rewrites run first, so an Afford Accept header wins over a markdown one. both run
  // before the filesystem and its cache, so neither representation is served for the other; the markdown
  // route sends its own `Vary: Accept`, since next replaces Vary on html pages
  rewrites: async () => ({
    beforeFiles: [
      { source: '/', has: [acceptsMarkdown], destination: '/llms.mdx' },
      { source: pages, has: [acceptsMarkdown], destination: '/llms.mdx/:path' },
    ],
    // `/quickstart.md` serves that page as plain markdown
    afterFiles: [{ source: '/:path+.md', destination: '/llms.mdx/:path+' }],
    fallback: [],
  }),
  // vlt-lock.json sits at the repo root, and next resolves `next` (and @afford/ui) from there
  turbopack: { root: path.join(import.meta.dirname, '../..') },
}

export default createMDX()(withAfford(nextConfig, { name: 'Afford docs' }))

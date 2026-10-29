import path from 'node:path'
import { createMDX } from 'fumadocs-mdx/next'
import { md } from '@afford/md/next'
import { withAfford } from '@afford/next/config'
import type { NextConfig } from 'next'

// the docs' old top-level urls, from before they moved under /docs
const pages = [
  'quickstart',
  'nextjs',
  'react',
  'mcp',
  'lint',
  'security',
  'bench',
  'protocol',
  'options',
  'md',
  'api-reference',
]
const folders = ['concepts', 'md', 'api-reference']

const nextConfig: NextConfig = {
  reactCompiler: true,
  cacheComponents: true,
  partialPrefetching: true,
  transpilePackages: ['@afford/ui'],
  // vlt-lock.json sits at the repo root, and next resolves `next` (and @afford/ui) from there
  // the docs moved under /docs (the site root is the marketing page now), and so did their markdown twins.
  // redirects run before rewrites, so /quickstart.md lands on /docs/quickstart.md and then on @afford/md
  redirects: async () => [
    { source: '/why', destination: '/docs', permanent: true },
    { source: '/why.md', destination: '/docs.md', permanent: true },
    { source: '/markdown', destination: '/docs/md', permanent: true },
    { source: '/markdown.md', destination: '/docs/md.md', permanent: true },
    ...pages.flatMap((page) => [
      { source: `/${page}`, destination: `/docs/${page}`, permanent: true },
      { source: `/${page}.md`, destination: `/docs/${page}.md`, permanent: true },
    ]),
    // folders: /concepts/actions and /concepts/actions.md alike
    ...folders.map((folder) => ({
      source: `/${folder}/:path+`,
      destination: `/docs/${folder}/:path+`,
      permanent: true,
    })),
  ],
  turbopack: { root: path.join(import.meta.dirname, '../..') },
}

// the graph for agents that speak afford, and markdown (`/page.md`, `Accept: text/markdown`) for the rest;
// each plugin's rewrites match only its own media type, so they don't collide
export default createMDX()(withAfford(nextConfig, { name: 'Afford docs', plugins: [md()] }))

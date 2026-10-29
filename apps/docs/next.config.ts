import path from 'node:path'
import { createMDX } from 'fumadocs-mdx/next'
import { md } from '@afford/md/next'
import { withAfford } from '@afford/next/config'
import type { NextConfig } from 'next'

// where each page lives now: guides and reference became folders under /docs
const moved: Record<string, string> = {
  quickstart: 'quickstart',
  concepts: 'concepts',
  nextjs: 'guides/nextjs',
  react: 'guides/react',
  mcp: 'guides/mcp',
  lint: 'guides/lint',
  security: 'guides/security',
  bench: 'guides/bench',
  md: 'guides/md',
  markdown: 'guides/md',
  protocol: 'reference/protocol',
  options: 'reference/options',
  'api-reference': 'reference/api-reference',
}

// a page and its markdown twin, plus (for folders) everything under it, .md twins included
const redirect = (from: string, to: string) => [
  { source: from, destination: to, permanent: true },
  { source: `${from}.md`, destination: `${to}.md`, permanent: true },
  { source: `${from}/:path+`, destination: `${to}/:path+`, permanent: true },
]

const nextConfig: NextConfig = {
  reactCompiler: true,
  cacheComponents: true,
  partialPrefetching: true,
  transpilePackages: ['@afford/ui'],
  // the docs moved under /docs (the site root is the marketing page now), then guides and reference moved
  // into folders. each old url goes straight to its page, no chains. redirects run before rewrites, so
  // /quickstart.md lands on /docs/quickstart.md and then on @afford/md
  redirects: async () => [
    ...redirect('/why', '/docs'),
    ...Object.entries(moved).flatMap(([from, to]) => [
      // /docs/quickstart and /docs/concepts didn't move, and /docs/markdown never existed
      ...(from === to || from === 'markdown' ? [] : redirect(`/docs/${from}`, `/docs/${to}`)),
      ...redirect(`/${from}`, `/docs/${to}`),
    ]),
  ],
  // vlt-lock.json sits at the repo root, and next resolves `next` (and @afford/ui) from there
  turbopack: { root: path.join(import.meta.dirname, '../..') },
}

// the graph for agents that speak afford, and markdown (`/page.md`, `Accept: text/markdown`) for the rest;
// each plugin's rewrites match only its own media type, so they don't collide
export default createMDX()(withAfford(nextConfig, { name: 'Afford docs', plugins: [md()] }))

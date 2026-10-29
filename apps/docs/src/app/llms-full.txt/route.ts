import { flattenTree } from 'fumadocs-core/page-tree'
import { connection } from 'next/server'
import { createLlmsFullHandler } from '@afford/md/next'
import { isApiReference, source } from '@/lib/source'

// every content page's markdown twin, in sidebar order; the generated API reference stays out (llms.txt
// lists it). it renders the site's own pages, so it runs per request: connection() keeps it out of the build
export const GET = createLlmsFullHandler({
  pages: async () => {
    await connection()
    return flattenTree(source.pageTree.children)
      .map((page) => page.url)
      .filter((url) => !isApiReference(url))
  },
})

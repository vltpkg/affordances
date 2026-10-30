'use server'

import { z } from 'zod'
import { AffordancesError, defineAction } from '@affordances/next'
import { GET as renderMarkdown, MD_PATH } from '@affordances/md/next'
import { pageFor, search } from '@/lib/source'

const result = z.object({
  title: z.string(),
  url: z.string(),
  description: z.string().optional(),
  // the matching headings and passages on that page, with <mark> around the match
  matches: z.array(z.string()),
})

export const searchDocs = defineAction({
  name: 'searchDocs',
  description:
    'Search the Affordances docs. Returns up to 8 pages, best first, each with the headings and passages that matched. Read one with getPage.',
  input: z.object({ query: z.string().min(1).describe('Words to look for') }),
  output: z.array(result),
  expose: 'public',
  readOnly: true,
  run: async ({ query }) => {
    const pages: z.infer<typeof result>[] = []
    for (const hit of await search(query)) {
      if (hit.type === 'page') {
        const page = pageFor(hit.url)
        pages.push({
          title: page?.data.title ?? hit.content,
          url: hit.url,
          ...(page?.data.description && { description: page.data.description }),
          matches: [],
        })
      } else pages.at(-1)?.matches.push(hit.content)
    }
    return pages.slice(0, 8)
  },
})

export const getPage = defineAction({
  name: 'getPage',
  description:
    'Read one page of the Affordances docs as Markdown, by its url, e.g. /docs/quickstart',
  input: z.object({
    url: z.string().startsWith('/').describe('The page url, as listed in sections'),
  }),
  output: z.string(),
  expose: 'public',
  readOnly: true,
  run: async ({ url }, ctx) => {
    const page = pageFor(url)
    if (!page || !ctx.request) throw new AffordancesError('not_found', `No docs page at ${url}`)
    // the page's markdown twin, as /<page>.md serves it: same render, same converter
    const response = await renderMarkdown(new Request(new URL(MD_PATH + page.url, ctx.request.url)))
    if (!response.ok) throw new AffordancesError('internal', `Couldn't render ${url}`)
    return response.text()
  },
})

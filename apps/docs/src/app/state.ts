import { defineState } from '@afford/next'
import { isApiReference, sections } from '@/lib/source'

// the docs' table of contents; getPage reads any page in it. the generated API reference is one entry
// rather than every page, to keep the graph small (llms.txt lists them all)
export default defineState(() => ({
  site: { name: 'Afford docs', llms: '/llms.txt', markdown: 'Append .md to any page url' },
  sections: sections().map((section) => ({
    ...section,
    pages: section.pages.filter(
      (page) => page.url === '/api-reference' || !isApiReference(page.url),
    ),
  })),
}))

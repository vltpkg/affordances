import { defineState } from '@afford/next'
import { isApiReference, pageFor, sections } from '@/lib/source'

// every docs page's graph: the page itself, and the docs' table of contents (getPage reads any page in
// it). the generated API reference is one entry rather than every page, to keep the graph small
export default defineState(({ params }) => {
  const slug = params.slug ?? []
  const url = ['/docs', ...(Array.isArray(slug) ? slug : [slug])].join('/')
  const page = pageFor(url)
  return {
    page: page
      ? {
          title: page.data.title,
          url: page.url,
          description: page.data.description,
          markdown: `${page.url}.md`,
        }
      : null,
    site: { name: 'Afford docs', llms: '/llms.txt', agents: '/agents' },
    sections: sections().map((section) => ({
      ...section,
      pages: section.pages.filter(
        (entry) => entry.url === '/docs/reference/api-reference' || !isApiReference(entry.url),
      ),
    })),
  }
})

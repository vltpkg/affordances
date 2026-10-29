import { defineDocs } from 'fumadocs-mdx/macro'
import { applyMdxPreset } from 'fumadocs-mdx/config'
import { loader, type InferPageType } from 'fumadocs-core/source'
import { getBreadcrumbItems } from 'fumadocs-core/breadcrumb'
import { createFromSource } from 'fumadocs-core/search/server'

// the slice of a hast node rehypeCodeMeta touches (hast types aren't a direct dependency)
type HastNode = {
  type: string
  tagName?: string
  data?: { meta?: string | null }
  properties?: Record<string, unknown>
  children?: HastNode[]
}

// a fence's meta (```ts title="app/actions.ts") isn't a prop, so lift its title onto the <code>
const rehypeCodeMeta = () => (tree: HastNode) => {
  const walk = (node: HastNode) => {
    const title = node.tagName === 'code' && node.data?.meta?.match(/title="([^"]*)"/)?.[1]
    if (title) node.properties = { ...node.properties, title }
    node.children?.forEach(walk)
  }
  walk(tree)
}

// `includeProcessedMarkdown` gives each page plain markdown via `getText("processed")`, for .md urls and llms-full.txt
const docs = defineDocs({
  dir: 'content',
  docs: {
    // @afford/ui's CodeBlock highlights on the server, so fumadocs' shiki (rehype-code) is off
    mdxOptions: applyMdxPreset({ rehypeCodeOptions: false, rehypePlugins: [rehypeCodeMeta] }),
    postprocess: {
      includeProcessedMarkdown: {
        headingIds: false,
        filterElement: (node) => node.type !== 'mdxjsEsm',
      },
    },
  },
})

export const source = loader({ baseUrl: '/', source: docs.toFumadocsSource() })

export type DocPage = InferPageType<typeof source>

// a page as plain markdown, for `/<page>.md`, llms-full.txt, and the getPage action
export const pageMarkdown = async (page: DocPage) =>
  `# ${page.data.title} (${page.url})\n\n${page.data.description ? `${page.data.description}\n\n` : ''}${(await page.data.getText('processed')).trim()}`

// content/meta.json groups pages under `---Label---` separators; each separator links to the page after it
const groupUrls = new Map(
  source.pageTree.children.flatMap((node, i, nodes) => {
    const next = nodes[i + 1]
    return node.type === 'separator' && next?.type === 'page'
      ? [[node.name, next.url] as const]
      : []
  }),
)

// a page's place in the sidebar, e.g. Concepts / Deltas, ending with the page itself
export const breadcrumbs = (url: string) =>
  getBreadcrumbItems(url, source.pageTree, { includePage: true, includeSeparator: true }).map(
    (item) => ({ ...item, url: item.url ?? groupUrls.get(item.name) }),
  )

// the sidebar's groups, as data: what the root graph and llms.txt list
export const sections = () => {
  const groups: { title: string; pages: { title: string; url: string; description?: string }[] }[] =
    []
  for (const node of source.pageTree.children) {
    if (node.type === 'separator') groups.push({ title: String(node.name), pages: [] })
    else if (node.type === 'page') {
      const page = source.getNodePage(node)
      groups.at(-1)?.pages.push({
        title: String(node.name),
        url: node.url,
        ...(page?.data.description && { description: page.data.description }),
      })
    }
  }
  return groups
}

const index = createFromSource(source, {
  buildIndex: (page) => ({
    id: page.url,
    url: page.url,
    title: page.data.title,
    description: page.data.description,
    structuredData: page.data.structuredData,
  }),
})

// table rows come back as raw markdown rows, which read as noise in results; their pages still match by text
export const search = async (query: string) =>
  (await index.search(query)).filter((result) => !result.table)

import { sections } from '@/lib/source'
import { siteUrl } from '@/lib/site-url'

const abs = (path: string) => new URL(path, siteUrl).href

// the llms.txt shape: a title, a summary, how to use the docs, then the page index, linking the markdown twins
export const GET = () =>
  new Response(
    `# Afford

> Afford makes Next.js apps operable by agents. Every page that opts in answers in HTML for people and in JSON (application/vnd.afford+json) for agents, at the same URL and with the same session. One \`defineAction\` becomes a server action, an HTTP endpoint, a WebMCP tool, and an MCP tool.

Every page is available as Markdown: append \`.md\` to its URL, or request it with \`Accept: text/markdown\`. [llms-full.txt](${abs('/llms-full.txt')}) holds every page in one file.

This site is itself Afford-enabled: \`GET ${abs('/')}\` with \`Accept: application/vnd.afford+json\` returns a graph with \`searchDocs\` and \`getPage\` actions, and [/.well-known/afford.json](${abs('/.well-known/afford.json')}) is the site index.

${sections()
  .map(
    ({ title, pages }) =>
      `## ${title}\n\n${pages.map((page) => `- [${page.title}](${abs(`${page.url}.md`)})${page.description ? `: ${page.description}` : ''}`).join('\n')}`,
  )
  .join('\n\n')}
`,
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  )

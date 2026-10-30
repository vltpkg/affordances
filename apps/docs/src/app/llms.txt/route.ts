import { createLlmsTxtHandler } from '@affordances/md/next'
import { sections } from '@/lib/source'

// the llms.txt index, from @affordances/md: the home page, the agents' page, then every docs page in sidebar
// order, linking their markdown twins. titles and descriptions come from the source, so nothing is rendered
export const GET = createLlmsTxtHandler({
  title: 'Affordances',
  summary:
    'Affordances makes Next.js apps operable by agents. Every page that opts in answers in HTML for people and in JSON (application/vnd.affordances+json) for agents, at the same URL and with the same session. One `defineAction` becomes a server action, an HTTP endpoint, a WebMCP tool, and an MCP tool.',
  intro:
    "These docs run on Affordances themselves: a docs page's graph has `searchDocs` and `getPage` actions.",
  sections: () => [
    {
      title: 'Start here',
      pages: [
        { url: '/', title: 'Affordances', description: 'What Affordances is, in one page.' },
        {
          url: '/agents',
          title: 'For agents',
          description: 'How an agent gets started with these docs and with Affordances.',
        },
      ],
    },
    ...sections().map(({ title, pages }) => ({
      title,
      pages: pages.map(({ url, title: page, description }) => ({ url, title: page, description })),
    })),
  ],
})

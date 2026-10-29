import { defineState } from '@affordances/next'

// the marketing page, for agents: what Affordances is and where to go next
export default defineState(
  () => ({
    product: {
      name: 'Affordances',
      summary:
        'An open protocol and Next.js toolkit. Declare what a page shows (state.ts) and what can be done there (actions.ts); people, browser agents, headless agents, and MCP clients all use the same definition.',
      install: 'vlx @affordances/cli init',
    },
    start: [
      { title: 'Quickstart', url: '/docs/quickstart' },
      { title: 'Docs', url: '/docs' },
      { title: 'For agents', url: '/agents' },
      { title: 'llms.txt', url: '/llms.txt' },
    ],
  }),
  {
    nav: () => [
      { to: '/docs', label: 'Docs' },
      { to: '/docs/quickstart', label: 'Quickstart' },
      { to: '/agents', label: 'For agents' },
    ],
  },
)

import { defineState } from '@afford/next'

// the marketing page, for agents: what Afford is and where to go next
export default defineState(
  () => ({
    product: {
      name: 'Afford',
      summary:
        'An open protocol and Next.js toolkit. Declare what a page shows (state.ts) and what can be done there (actions.ts); people, browser agents, headless agents, and MCP clients all use the same definition.',
      install: 'npx @afford/next init',
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

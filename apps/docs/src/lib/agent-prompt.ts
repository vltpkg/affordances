import { siteUrl } from '@/lib/site-url'

const docs = siteUrl.origin

// what to paste into a coding agent to set up an app; shown on /agents and in the Next.js getting started guide
export const setupPrompt = `Help me make this Next.js app agent-operable with Affordances. Start by reading ${docs}/llms.txt, which lists every page of the Affordances docs. Any page is available as Markdown by adding .md to its URL (for example ${docs}/docs/quickstart.md), and ${docs}/llms-full.txt has the whole site in one file.

1. Follow ${docs}/docs/guides/nextjs/getting-started.md: install @affordances/next, @affordances/react, and zod, then run \`vlx @affordances/next init\`. It writes the route handler, wraps next.config.ts with withAffordances, and generates the manifest.
2. Next to each page an agent should operate, add a state.ts (what the page shows) and an actions.ts with defineAction. Set \`expose\` on every action an agent may call, and use 'confirm' for anything that spends money or can't be undone.
3. Check your work with curl -H 'Accept: application/vnd.affordances+json' on the page's URL, and read ${docs}/docs/guides/nextjs/sessions.md and ${docs}/docs/guides/security.md before exposing anything that needs a session.

Only use APIs that appear in the docs.`

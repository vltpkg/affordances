import Link from 'next/link'
import type { Metadata } from 'next'
import {
  ArrowRightLeftIcon,
  BookOpenIcon,
  BracesIcon,
  CableIcon,
  FileTextIcon,
  FlaskConicalIcon,
  GaugeIcon,
  KeyRoundIcon,
  LayersIcon,
  ListChecksIcon,
  MousePointerClickIcon,
  NetworkIcon,
  RocketIcon,
  ScrollTextIcon,
  ShieldCheckIcon,
  SquareCodeIcon,
  TerminalIcon,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { mdAlternate } from '@afford/md/next'
import { AgentMain, AgentText } from '@afford/md/react'
import { Button } from '@/components/ui/button'
import { AgentPrompt } from '@/components/agent-prompt'
import { Book } from '@/components/book'
import { benchResults } from '@/lib/bench'
import { siteUrl } from '@/lib/site-url'

const lede =
  'Everything on this site is readable without a browser. Start from llms.txt, read any page as Markdown, or ask the docs for their graph. To make an app agent-operable, hand your agent the prompt below.'

export const metadata: Metadata = {
  title: 'For agents',
  description: lede,
  alternates: { canonical: '/agents', ...mdAlternate('/agents') },
}

const docs = siteUrl.origin

const prompt = `Help me make this Next.js app agent-operable with Afford. Start by reading ${docs}/llms.txt, which lists every page of the Afford docs. Any page is available as Markdown by adding .md to its URL (for example ${docs}/docs/quickstart.md), and ${docs}/llms-full.txt has the whole site in one file.

1. Follow ${docs}/docs/quickstart.md: install @afford/next, @afford/react, and zod, then run \`vlx @afford/next init\`. It writes the route handler, wraps next.config.ts with withAfford, and generates the manifest.
2. Next to each page an agent should operate, add a state.ts (what the page shows) and an actions.ts with defineAction. Set \`expose\` on every action an agent may call, and use 'confirm' for anything that spends money or can't be undone.
3. Check your work with curl -H 'Accept: application/vnd.afford+json' on the page's URL, and read ${docs}/docs/guides/security.md before exposing anything that needs a session.

Only use APIs that appear in the docs.`

type Card = {
  icon: LucideIcon
  title: string
  description: string
  href: string
}

const bench = benchResults()

const cards: Card[] = [
  {
    icon: BookOpenIcon,
    title: 'llms.txt',
    description: 'An index of every page on this site, for agents to read before anything else.',
    href: '/llms.txt',
  },
  {
    icon: FileTextIcon,
    title: 'Markdown pages',
    description:
      "Add .md to any page's URL for a plain Markdown copy, or read the whole site in one file.",
    href: '/llms-full.txt',
  },
  {
    icon: BracesIcon,
    title: 'This site’s graph',
    description:
      'These docs run on Afford: ask / for application/vnd.afford+json, and search and read pages as actions.',
    href: '/docs/quickstart#read-the-graph',
  },
  {
    icon: CableIcon,
    title: 'MCP',
    description: 'Serve any Afford site to Claude, Cursor, and other MCP clients as two tools.',
    href: '/docs/guides/mcp',
  },
]

// task-shaped walkthroughs from the docs, shelved as books; descriptions paraphrase each page's intro
const guides: (Card & { color: string })[] = [
  {
    icon: RocketIcon,
    title: 'Make a page agent-operable',
    description: 'Init, a state file, an action, and curl.',
    href: '/docs/quickstart',
    color: 'oklch(0.72 0.13 70)',
  },
  {
    icon: KeyRoundIcon,
    title: 'Share your session with agents',
    description: 'One auth resolver for the UI and the agent path.',
    href: '/docs/guides/nextjs',
    color: 'oklch(0.72 0.13 250)',
  },
  {
    icon: ShieldCheckIcon,
    title: 'Ask before an order goes through',
    description: 'Confirm actions run only after the person approves.',
    href: '/docs/concepts/expose',
    color: 'oklch(0.72 0.13 155)',
  },
  {
    icon: MousePointerClickIcon,
    title: 'Give browser agents tools',
    description: 'WebMCP tools from the page’s own graph.',
    href: '/docs/guides/react',
    color: 'oklch(0.72 0.13 20)',
  },
  {
    icon: TerminalIcon,
    title: 'Connect Claude to your site',
    description: 'Two MCP tools over any Afford site.',
    href: '/docs/guides/mcp',
    color: 'oklch(0.72 0.13 300)',
  },
  {
    icon: ListChecksIcon,
    title: 'Guard what agents can do',
    description: 'Preconditions agents see before they call.',
    href: '/docs/concepts/guards',
    color: 'oklch(0.72 0.13 200)',
  },
  {
    icon: ArrowRightLeftIcon,
    title: 'Answer with what changed',
    description: 'Deltas: changed entities, output, and next steps.',
    href: '/docs/concepts/deltas',
    color: 'oklch(0.72 0.13 110)',
  },
  {
    icon: SquareCodeIcon,
    title: 'Catch unmarked controls',
    description: 'Lint rules for Affordance and action names.',
    href: '/docs/guides/lint',
    color: 'oklch(0.72 0.13 340)',
  },
]

// descriptions paraphrase each page's intro in content/
const sections: { title: string; cards: Card[] }[] = [
  {
    title: 'Concepts',
    cards: [
      {
        icon: MousePointerClickIcon,
        title: 'Actions',
        description:
          'One defineAction call describes something a person or an agent can do on a page, and returns the server action that does it.',
        href: '/docs/concepts/actions',
      },
      {
        icon: LayersIcon,
        title: 'State',
        description:
          "A route's state.ts says what the page shows, as entities. It's loaded for the graph and again after every action.",
        href: '/docs/concepts/state',
      },
      {
        icon: KeyRoundIcon,
        title: 'Expose',
        description:
          'Nothing reaches agents until an action says who may call it: public, session, or confirm.',
        href: '/docs/concepts/expose',
      },
      {
        icon: ListChecksIcon,
        title: 'Guards and confirm',
        description:
          'The precondition an action checks before it runs. Agents see it before they call, and get its reason when it fails.',
        href: '/docs/concepts/guards',
      },
      {
        icon: ArrowRightLeftIcon,
        title: 'Deltas',
        description:
          "Calling an action returns what changed on the page, so the agent doesn't have to read it again.",
        href: '/docs/concepts/deltas',
      },
    ],
  },
  {
    title: 'Reference',
    cards: [
      {
        icon: ScrollTextIcon,
        title: 'Protocol',
        description:
          'The normative Afford protocol, version 0: discovery, graphs, calls, deltas, and error codes.',
        href: '/docs/reference/protocol',
      },
      {
        icon: ShieldCheckIcon,
        title: 'Security',
        description:
          'Default deny, explicit confirmation, Origin checks for cookies, and a fixed order of checks on every call.',
        href: '/docs/guides/security',
      },
      {
        icon: ListChecksIcon,
        title: 'Options',
        description: 'Every option of defineAction, createHandler, and withAfford, in one place.',
        href: '/docs/reference/options',
      },
      {
        icon: NetworkIcon,
        title: 'API reference',
        description: 'Every export of every package, with its types, generated from the source.',
        href: '/docs/reference/api-reference',
      },
      {
        icon: bench.length ? GaugeIcon : FlaskConicalIcon,
        title: 'Bench',
        description: bench.length
          ? 'A browser agent and an Afford agent on the same tasks, with committed results.'
          : 'A browser agent and an Afford agent on the same tasks. Results will appear after the first committed bench run.',
        href: '/docs/guides/bench',
      },
    ],
  },
]

// card grids and the book shelf, as the markdown twin has them: a plain list of links
const mdLinks = (items: Card[]) =>
  items.map(({ title, href, description }) => `- [${title}](${href}): ${description}`).join('\n')

const CardGrid = ({ items }: { items: Card[] }) => (
  <AgentText block md={mdLinks(items)}>
    <ul className="mt-6 grid gap-4 md:grid-cols-3">
      {items.map(({ icon: Icon, title, description, href }) => (
        <li key={title}>
          <Link
            href={href}
            // llms.txt and friends are route handlers, not pages
            prefetch={href.includes('.') ? false : undefined}
            className="flex h-full flex-col rounded-xl border p-6 transition-colors hover:bg-card focus-visible:outline-2 focus-visible:outline-ring"
          >
            <Icon aria-hidden className="size-5" />
            <h3 className="mt-6 font-medium">{title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
          </Link>
        </li>
      ))}
    </ul>
  </AgentText>
)

const Agents = () => (
  <div className="typeset-docs mx-auto w-full max-w-6xl">
    {/* the whole page is content; the interactive parts are described for the markdown twin below */}
    <AgentMain>
      <section className="max-w-3xl">
        <h1 className="text-5xl font-semibold tracking-tighter text-balance sm:text-6xl sm:leading-[1.05]">
          Start here, agents
        </h1>
        <p className="mt-6 text-lg text-pretty text-muted-foreground sm:text-xl">{lede}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="lg" className="px-4">
            <Link href="/llms.txt" prefetch={false}>
              Read llms.txt
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="px-4">
            <Link href="/docs/quickstart">Quickstart</Link>
          </Button>
        </div>
      </section>

      <section className="mt-16">
        <h2 className="text-2xl font-semibold tracking-tight">Set up your agent</h2>
        <p className="mt-3 max-w-[65ch] text-pretty text-muted-foreground">
          Every page on this site is also available as Markdown, and{' '}
          <code className="font-mono text-[0.875em] text-foreground">/llms.txt</code> indexes them
          all. Paste this prompt into your agent to point it at the docs:
        </p>
        <div className="mt-6">
          <AgentText block md={`\`\`\`text\n${prompt}\n\`\`\``}>
            <AgentPrompt prompt={prompt} />
          </AgentText>
        </div>
        <div className="mt-4">
          <CardGrid items={cards} />
        </div>
      </section>

      <section className="mt-24">
        <h2 className="text-2xl font-semibold tracking-tight">Guides</h2>
        <p className="mt-3 max-w-[65ch] text-pretty text-muted-foreground">
          Walkthroughs for the things teams set out to do first.
        </p>
        {/* two to a row on phones, four on desktop; each book shrinks with the breakpoint to fit */}
        <AgentText block md={mdLinks(guides)}>
          <ul className="mt-10 grid grid-cols-2 gap-x-4 gap-y-12 md:grid-cols-4 md:gap-x-8">
            {guides.map(({ icon: Icon, title, description, href, color }) => (
              <li key={href + title} className="flex flex-col">
                <Book
                  href={href}
                  title={title}
                  color={color}
                  icon={<Icon />}
                  width={{ xs: 150, sm: 160, md: 170, lg: 196 }}
                  description={description}
                />
              </li>
            ))}
          </ul>
        </AgentText>
      </section>

      {sections.map((section) => (
        <section key={section.title} className="mt-24">
          <h2 className="text-2xl font-semibold tracking-tight">{section.title}</h2>
          <CardGrid items={section.cards} />
        </section>
      ))}
    </AgentMain>
  </div>
)

export default Agents

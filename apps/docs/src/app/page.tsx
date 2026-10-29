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
import { AffordProvider } from '@afford/react'
import { Button } from '@/components/ui/button'
import { AgentPrompt } from '@/components/agent-prompt'
import { Book } from '@/components/book'
import { TwoViews } from '@/components/two-views'
import { benchResults } from '@/lib/bench'
import { siteUrl } from '@/lib/site-url'

const lede =
  'Afford gives each page of a Next.js app a JSON view for agents, at the same URL and with the same session. Define an action once, and it runs as a server action, an HTTP endpoint, a WebMCP tool, and an MCP tool.'

export const metadata: Metadata = {
  title: { absolute: 'Afford docs' },
  description: lede,
  alternates: { canonical: '/' },
}

const docs = siteUrl.origin

const prompt = `Help me make this Next.js app agent-operable with Afford. Start by reading ${docs}/llms.txt, which lists every page of the Afford docs. Any page is available as Markdown by adding .md to its URL (for example ${docs}/quickstart.md), and ${docs}/llms-full.txt has the whole site in one file.

1. Follow ${docs}/quickstart.md: install @afford/next, @afford/react, and zod, then run \`npx @afford/next init\`. It writes the route handler, wraps next.config.ts with withAfford, and generates the manifest.
2. Next to each page an agent should operate, add a state.ts (what the page shows) and an actions.ts with defineAction. Set \`expose\` on every action an agent may call, and use 'confirm' for anything that spends money or can't be undone.
3. Check your work with curl -H 'Accept: application/vnd.afford+json' on the page's URL, and read ${docs}/security.md before exposing anything that needs a session.

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
    href: '/quickstart#read-the-graph',
  },
  {
    icon: CableIcon,
    title: 'MCP',
    description: 'Serve any Afford site to Claude, Cursor, and other MCP clients as two tools.',
    href: '/mcp',
  },
]

// task-shaped walkthroughs from the docs, shelved as books; descriptions paraphrase each page's intro
const guides: (Card & { color: string })[] = [
  {
    icon: RocketIcon,
    title: 'Make a page agent-operable',
    description: 'Init, a state file, an action, and curl.',
    href: '/quickstart',
    color: 'oklch(0.72 0.13 70)',
  },
  {
    icon: KeyRoundIcon,
    title: 'Share your session with agents',
    description: 'One auth resolver for the UI and the agent path.',
    href: '/nextjs',
    color: 'oklch(0.72 0.13 250)',
  },
  {
    icon: ShieldCheckIcon,
    title: 'Ask before an order goes through',
    description: 'Confirm actions run only after the person approves.',
    href: '/concepts/expose',
    color: 'oklch(0.72 0.13 155)',
  },
  {
    icon: MousePointerClickIcon,
    title: 'Give browser agents tools',
    description: 'WebMCP tools from the page’s own graph.',
    href: '/react',
    color: 'oklch(0.72 0.13 20)',
  },
  {
    icon: TerminalIcon,
    title: 'Connect Claude to your site',
    description: 'Two MCP tools over any Afford site.',
    href: '/mcp',
    color: 'oklch(0.72 0.13 300)',
  },
  {
    icon: ListChecksIcon,
    title: 'Guard what agents can do',
    description: 'Preconditions agents see before they call.',
    href: '/concepts/guards',
    color: 'oklch(0.72 0.13 200)',
  },
  {
    icon: ArrowRightLeftIcon,
    title: 'Answer with what changed',
    description: 'Deltas: changed entities, output, and next steps.',
    href: '/concepts/deltas',
    color: 'oklch(0.72 0.13 110)',
  },
  {
    icon: SquareCodeIcon,
    title: 'Catch unmarked controls',
    description: 'Lint rules for Affordance and action names.',
    href: '/lint',
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
        href: '/concepts/actions',
      },
      {
        icon: LayersIcon,
        title: 'State',
        description:
          "A route's state.ts says what the page shows, as entities. It's loaded for the graph and again after every action.",
        href: '/concepts/state',
      },
      {
        icon: KeyRoundIcon,
        title: 'Expose',
        description:
          'Nothing reaches agents until an action says who may call it: public, session, or confirm.',
        href: '/concepts/expose',
      },
      {
        icon: ListChecksIcon,
        title: 'Guards and confirm',
        description:
          'The precondition an action checks before it runs. Agents see it before they call, and get its reason when it fails.',
        href: '/concepts/guards',
      },
      {
        icon: ArrowRightLeftIcon,
        title: 'Deltas',
        description:
          "Calling an action returns what changed on the page, so the agent doesn't have to read it again.",
        href: '/concepts/deltas',
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
        href: '/protocol',
      },
      {
        icon: ShieldCheckIcon,
        title: 'Security',
        description:
          'Default deny, explicit confirmation, Origin checks for cookies, and a fixed order of checks on every call.',
        href: '/security',
      },
      {
        icon: NetworkIcon,
        title: 'API reference',
        description: 'Every option of defineAction, createHandler, and withAfford.',
        href: '/api-reference',
      },
      {
        icon: bench.length ? GaugeIcon : FlaskConicalIcon,
        title: 'Bench',
        description: bench.length
          ? 'A screenshot-driven agent and an Afford agent on the same tasks, with committed results.'
          : 'A screenshot-driven agent and an Afford agent on the same tasks. Results will appear after the first committed bench run.',
        href: '/bench',
      },
    ],
  },
]

const CardGrid = ({ items }: { items: Card[] }) => (
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
)

const Home = () => (
  // the docs root has a graph of its own (searchDocs, getPage); the provider registers it as WebMCP tools
  <AffordProvider path="/">
    <div className="typeset-docs mx-auto w-full max-w-6xl">
      <section className="max-w-3xl">
        <h1 className="text-5xl font-semibold tracking-tighter text-balance sm:text-6xl sm:leading-[1.05]">
          {/* a non-breaking hyphen, so the compound never splits across lines */}
          Make every page agent‑operable
        </h1>
        <p className="mt-6 text-lg text-pretty text-muted-foreground sm:text-xl">{lede}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="lg" className="px-4">
            <Link href="/quickstart">Quickstart</Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="px-4">
            <Link href="/why">Why Afford</Link>
          </Button>
        </div>
      </section>

      <section className="mt-16" aria-label="Two views of one URL">
        <TwoViews />
      </section>

      <section className="mt-24">
        <h2 className="text-2xl font-semibold tracking-tight">Set up your agent</h2>
        <p className="mt-3 max-w-[65ch] text-pretty text-muted-foreground">
          Every page on this site is also available as Markdown, and{' '}
          <code className="font-mono text-[0.875em] text-foreground">/llms.txt</code> indexes them
          all. Paste this prompt into your agent to point it at the docs:
        </p>
        <div className="mt-6">
          <AgentPrompt prompt={prompt} />
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
      </section>

      {sections.map((section) => (
        <section key={section.title} className="mt-24">
          <h2 className="text-2xl font-semibold tracking-tight">{section.title}</h2>
          <CardGrid items={section.cards} />
        </section>
      ))}
    </div>
  </AffordProvider>
)

export default Home

import type { Metadata } from 'next'
import Link from 'next/link'
import { cn } from 'cn'
import { mdAlternate } from '@afford/md/next'
import { AgentMain, AgentText } from '@afford/md/react'
import { CodeBlock } from '@afford/ui/components/code-block'
import { Button } from '@/components/ui/button'
import { After, Before } from '@/components/marketing/scrolly'
import { Code, SectionHead } from '@/components/marketing/section-head'
import { Approvals } from '@/components/marketing/approvals'
import { CopyCommand } from '@/components/marketing/copy-command'
import { HeroStage } from '@/components/marketing/hero-stage'
import { latestBench, type BenchSummary } from '@/lib/bench'
import { siteUrl } from '@/lib/site-url'
import { exec, packageManagers } from '@/lib/package-managers'

export const metadata: Metadata = {
  title: { absolute: 'Afford: every page, agent-operable' },
  description:
    'Your UI already knows what it can do. Afford lets you declare it once, and humans, browser agents, headless agents, and MCP clients all use the same definition.',
  alternates: { canonical: '/', ...mdAlternate('/') },
}

const SRC_A = `'use server'

export const addToCart = defineAction({
  name: 'addToCart',
  input: z.object({ sku: z.string(), size: z.number() }),
  expose: 'session',
  effects: ['cart'],
  run: (input) => cart.add(input),
})`

const SRC_S = `export default defineState(async ({ params }) => ({
  product: await getProduct(params.slug),
  cart: await getCart(),
}))`

const FAN = [
  {
    t: 'Server Action',
    w: 'Humans',
    d: 'The button on the page calls it, like any server action.',
    ag: false,
  },
  {
    t: 'WebMCP tool',
    w: 'Browser agents',
    d: 'Registered in the tab, so an agent in the browser can call it.',
    ag: true,
  },
  {
    t: 'HTTP graph',
    w: 'Headless agents',
    d: 'GET the page as afford+json, then POST the action.',
    ag: true,
  },
  {
    t: 'MCP tool',
    w: 'Claude, Cursor',
    d: 'Called through @afford/mcp. Same schema, same guard.',
    ag: true,
  },
  { t: 'Markdown', w: 'Readers', d: 'The page as text/markdown, indexed by /llms.txt.', ag: false },
]

// the bench's own summary, as measured: medians per task and the share of tasks completed; the change is
// computed from the same two numbers
type Side = BenchSummary['browser']
const pct = (from: number, to: number) =>
  from === to
    ? 'Same'
    : `${to < from ? '−' : '+'}${Math.round((Math.abs(to - from) / from) * 100)}%`
const STATS: { k: string; u: string; v: (s: Side) => string; d: (b: Side, a: Side) => string }[] = [
  {
    k: 'Steps',
    u: 'Median turns per task',
    v: (s) => String(s.medianTurns),
    d: (b, a) => pct(b.medianTurns, a.medianTurns),
  },
  {
    k: 'Tokens',
    u: 'Median per task',
    v: (s) => s.medianTokens.toLocaleString('en-US'),
    d: (b, a) => pct(b.medianTokens, a.medianTokens),
  },
  {
    k: 'Time',
    u: 'Median wall clock per task',
    v: (s) => `${(s.medianMs / 1000).toFixed(1)}s`,
    d: (b, a) => pct(b.medianMs, a.medianMs),
  },
  {
    k: 'Success rate',
    u: 'Share of tasks completed',
    v: (s) => `${Math.round(s.successRate * 100)}%`,
    d: (b, a) => {
      const pts = Math.round((a.successRate - b.successRate) * 100)
      return pts === 0 ? 'Same' : `${pts > 0 ? '+' : '−'}${Math.abs(pts)} pts`
    },
  },
]

const sec = 'relative px-14 py-24 max-[899px]:px-5 max-[899px]:py-[72px]'
const btn = 'h-11 rounded-lg px-[18px] text-sm active:scale-[0.97]'
const num =
  'text-right text-[22px] font-semibold tracking-[-0.02em] tabular-nums max-[599px]:text-lg'

const Dot = ({ agent }: { agent?: boolean }) => (
  <span
    className={cn('size-[7px] flex-none rounded-full', agent ? 'bg-(--agent)' : 'bg-(--fg3)')}
  />
)

const curl = `curl -H 'Accept: application/vnd.afford+json' ${siteUrl.host}`

const Home = () => {
  const bench = latestBench()
  return (
    <div className="afd flex-1 bg-(--bg) text-(--fg)">
      <AgentMain>
        <main className="mx-auto max-w-[1200px]" id="main">
          <section
            className="flex flex-wrap items-center gap-14 px-14 pt-[88px] pb-24 max-[899px]:gap-12 max-[899px]:px-5 max-[899px]:pt-12 max-[899px]:pb-[72px]"
            aria-labelledby="h-hero"
          >
            <div className="min-w-0 flex-[1_1_400px]">
              <h1
                id="h-hero"
                className="text-[clamp(46px,6vw,76px)] leading-[0.98] font-semibold tracking-[-0.055em] text-balance"
              >
                {/* a non-breaking hyphen keeps the compound on one line */}
                Every page, agent‑operable.
              </h1>
              <p className="mt-6 max-w-[500px] text-[19px] leading-[1.6] text-pretty text-(--fg2) max-[899px]:text-[17px]">
                Your UI already knows what it can do. Afford lets you declare it once. Humans,
                browser agents, headless agents and MCP clients all use the same definition.
              </p>
              <div className="mt-8 flex flex-wrap gap-2.5">
                <Button asChild className={btn}>
                  <Link href="/docs/quickstart">Get started</Link>
                </Button>
                <Button asChild variant="outline" className={btn}>
                  <a href="#how">How it works</a>
                </Button>
              </div>
            </div>
            <AgentText
              block
              md="**One URL, two readers.** A product page, a team settings page, and a booking page, each shown as a person sees it (`text/html`) and as the graph an agent reads (`application/vnd.afford+json`) at the same URL: its entities, its action with input, guard, and availability, and its nav. Calling the action returns a delta with only what changed."
            >
              <HeroStage />
            </AgentText>
          </section>

          <section className={sec} aria-labelledby="h-shift">
            <SectionHead eyebrow="The shift" id="h-shift" title="Every page has two readers now." />
            <div className="grid grid-cols-2 border-y border-(--line) max-[899px]:grid-cols-1">
              <div className="flex flex-col gap-2.5 py-8 pr-8 max-[899px]:py-7 max-[899px]:pr-0">
                <div className="flex items-center gap-2 font-mono text-xs text-(--fg3)">
                  <Dot />
                  Human · text/html
                </div>
                <p className="mt-1.5 text-[28px] leading-[1.15] font-semibold tracking-[-0.03em]">
                  Reads pixels.
                </p>
                <p className="max-w-[440px] text-[15px] leading-[1.6] text-(--fg2)">
                  Scrolls, hovers, decides. Your UI was built for this reader, and it shows.
                </p>
              </div>
              <div className="flex flex-col gap-2.5 border-l border-(--line) py-8 pl-8 max-[899px]:border-t max-[899px]:border-l-0 max-[899px]:py-7 max-[899px]:pl-0">
                <div className="flex items-center gap-2 font-mono text-xs text-(--agent)">
                  <Dot agent />
                  Agent · application/vnd.afford+json
                </div>
                <p className="mt-1.5 text-[28px] leading-[1.15] font-semibold tracking-[-0.03em]">
                  Reads structure.
                </p>
                <p className="max-w-[440px] text-[15px] leading-[1.6] text-(--fg2)">
                  Needs names, inputs and preconditions. Today it gets a screenshot and a guess.
                </p>
              </div>
            </div>
          </section>

          <section className={sec} aria-labelledby="h-before">
            <AgentText
              block
              md={`Before\n\n## Serving agents today means describing every page five more times.\n\nA markdown twin. An OpenAPI spec. MCP routes. Tool handlers. WebMCP glue. Each one a hand-written copy of what the UI already knows. Change a price in \`page.tsx\` and five files still say the old one: nothing fails, agents just get it wrong. Meanwhile a screenshot agent takes twenty-five screenshots, and overruns its context window, to add one pair of shoes to a cart.`}
            >
              <Before />
            </AgentText>
          </section>

          <section className={sec} aria-labelledby="h-after">
            <AgentText
              block
              md={`After, with Afford\n\n## Three files per route. One definition.\n\n\`page.tsx\` renders. \`state.ts\` says what's on the page. \`actions.ts\` says what can be done. Every agent surface (server action, WebMCP, HTTP graph, MCP, Markdown) is derived from those, so one edit reaches all of them. The agent finishes in five calls: read the graph, add to cart, read the checkout, then place the order, once to get the confirmation summary and once with \`confirm: true\`.`}
            >
              <After />
            </AgentText>
          </section>

          <section className={sec} id="how" aria-labelledby="h-how">
            <SectionHead eyebrow="How it works" id="h-how" title="Declare it next to the page.">
              An action is a server action with a schema, an exposure level and a list of what it
              changes. State is what the page shows, as entities. That’s the contract.
            </SectionHead>
            <div className="grid grid-cols-2 gap-4 max-[899px]:grid-cols-1">
              <CodeBlock lang="ts" title="actions.ts">
                {SRC_A}
              </CodeBlock>
              <CodeBlock lang="ts" title="state.ts">
                {SRC_S}
              </CodeBlock>
            </div>
            <AgentText
              block
              md={`One \`defineAction\`, five surfaces:\n\n${FAN.map((f) => `- **${f.t}** (${f.w}): ${f.d}`).join('\n')}`}
            >
              <figure
                aria-label="One defineAction produces five surfaces"
                className="relative mt-16 flex flex-col items-center max-[899px]:items-stretch"
              >
                <div className="inline-flex h-12 items-center gap-2.5 rounded-[10px] border border-(--fg) bg-(--bg) px-5 font-mono text-sm font-medium max-[899px]:self-start">
                  defineAction()
                </div>
                <div className="h-8 w-0 border-l border-(--line2) max-[899px]:ml-5 max-[899px]:h-5" />
                <div className="relative grid w-full grid-cols-5 gap-3 pt-8 max-[899px]:grid-cols-1 max-[899px]:gap-2.5 max-[899px]:pt-0 max-[899px]:pl-12">
                  <div className="absolute inset-x-[10%] top-0 h-0 border-t border-(--line2) max-[899px]:inset-x-auto max-[899px]:top-0 max-[899px]:bottom-[30px] max-[899px]:left-5 max-[899px]:h-auto max-[899px]:border-t-0 max-[899px]:border-l" />
                  {FAN.map((f) => (
                    <div
                      key={f.t}
                      className={cn(
                        'fan-card relative flex min-w-0 flex-col gap-2 rounded-[10px] border bg-(--bg) px-4 py-[18px]',
                        f.ag ? 'ag border-(--agent-line)' : 'border-(--line2)',
                      )}
                    >
                      <span
                        className={cn(
                          'flex items-center gap-1.5 font-mono text-xs leading-none',
                          f.ag ? 'text-(--agent)' : 'text-(--fg3)',
                        )}
                      >
                        <Dot agent={f.ag} />
                        {f.w}
                      </span>
                      <p className="text-[15px] font-semibold tracking-[-0.01em]">{f.t}</p>
                      <p className="text-[13px] leading-normal text-(--fg2)">{f.d}</p>
                    </div>
                  ))}
                </div>
              </figure>
            </AgentText>
          </section>

          <section className={sec} aria-labelledby="h-appr">
            <SectionHead eyebrow="Approvals" id="h-appr" title="Agents act. Humans approve.">
              Mark an action <Code>expose: &apos;confirm&apos;</Code> and an agent can prepare it
              but never finish it. The call waits for a person.
            </SectionHead>
            <AgentText
              block
              md={
                "```ts\nexport const placeOrder = defineAction({\n  name: 'placeOrder',\n  expose: 'confirm',\n  run: (input, ctx) => orders.place(ctx.session.id),\n})\n```\n\nAn agent's first call answers `409 confirm_required` with a summary (\"Place order · $244.00\"). Nothing runs until the person approves and the agent sends the call again with `confirm: true`."
              }
            >
              <Approvals />
            </AgentText>
          </section>

          <section className={sec} id="proof" aria-labelledby="h-proof">
            <SectionHead eyebrow="Proof" id="h-proof" title="Measured, not claimed.">
              Same tasks, same model: a browser agent reading accessibility snapshots against an
              Afford agent.{' '}
              {bench ? (
                <>
                  From the latest committed run ({bench.tasks} tasks
                  {bench.runs ? `, ${bench.runs} ${bench.runs === 1 ? 'run' : 'runs'} each` : ''}
                  {bench.model ? `, ${bench.model}` : ''}); the{' '}
                  <Link
                    href="/docs/guides/bench"
                    className="text-(--fg) underline decoration-(--line2) underline-offset-4 transition-colors duration-150 hover:decoration-(--fg)"
                  >
                    bench page
                  </Link>{' '}
                  has every row.
                </>
              ) : (
                'Results appear here after the first committed bench run.'
              )}
            </SectionHead>
            <table className="w-full border-collapse text-[15px]">
              <caption className="sr-only">Browser agent against Afford agent, per task</caption>
              <thead>
                <tr>
                  {['Metric', 'Browser agent', 'Afford agent', 'Change'].map((h, i) => (
                    <th
                      key={h}
                      scope="col"
                      className={cn(
                        'border-b border-(--line2) pb-3.5 pl-4 text-left align-bottom text-[13px] leading-[1.3] font-medium text-(--fg3) first:pl-0 max-[599px]:pl-3',
                        i > 0 && 'text-right',
                        i === 2 && 'text-(--agent)',
                      )}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {STATS.map((s) => (
                  <tr key={s.k}>
                    <th
                      scope="row"
                      className="border-b border-(--line) py-5 text-left align-baseline font-normal"
                    >
                      {/* two lines for people, one cell for the markdown */}
                      <AgentText
                        md={`${s.k} (${(bench ? s.u : `${s.u}, pending bench`).toLowerCase()})`}
                      >
                        <span className="block text-[15px] text-(--fg)">{s.k}</span>
                        <span className="mt-1 block text-[13px] text-(--fg3)">
                          {bench ? s.u : `${s.u}, pending bench`}
                        </span>
                      </AgentText>
                    </th>
                    <td
                      className={cn(
                        num,
                        'border-b border-(--line) py-5 pl-4 align-baseline text-(--fg2) max-[599px]:pl-3',
                      )}
                    >
                      {bench ? s.v(bench.browser) : '–'}
                    </td>
                    <td
                      className={cn(
                        num,
                        'border-b border-(--line) py-5 pl-4 align-baseline max-[599px]:pl-3',
                        bench ? 'text-(--fg)' : 'text-(--fg2)',
                      )}
                    >
                      {bench ? s.v(bench.afford) : '–'}
                    </td>
                    <td className="border-b border-(--line) py-5 pl-4 text-right align-baseline font-mono text-[13px] text-(--fg2) tabular-nums max-[599px]:pl-3">
                      {bench ? s.d(bench.browser, bench.afford) : '–'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className={sec} aria-labelledby="h-pr">
            <p className="mb-6 font-pixel text-sm text-(--fg3)" id="h-pr">
              Principles
            </p>
            <div className="flex flex-col">
              {[
                ['Agents need signal, ', 'not pixels.'],
                ['Measure impact, ', 'not tokens.'],
                ['Agents act, ', 'humans approve.'],
              ].map(([a, b]) => (
                <p
                  key={a}
                  className="border-t border-(--line) py-8 text-[clamp(30px,4.6vw,60px)] leading-[1.04] font-semibold tracking-[-0.045em] text-balance last:border-b max-[899px]:py-6"
                >
                  {a}
                  <span className="text-(--fg3)">{b}</span>
                </p>
              ))}
            </div>
            <div
              className="mt-16 flex items-baseline gap-4 font-mono text-[13px] leading-[1.7] text-(--fg2)"
              id="agents"
            >
              <span aria-hidden className="whitespace-nowrap text-(--agent)">
                {'{ }'}
              </span>
              <div className="flex min-w-0 flex-col gap-4">
                <p className="text-pretty">
                  Reading this as an agent? Request <Code>text/markdown</Code> or start at{' '}
                  <Link
                    href="/llms.txt"
                    prefetch={false}
                    className="text-(--agent) underline underline-offset-[3px]"
                  >
                    /llms.txt
                  </Link>{' '}
                  and{' '}
                  <Link href="/agents" className="text-(--agent) underline underline-offset-[3px]">
                    /agents
                  </Link>
                  . We left the pixels for the humans.
                </p>
                <AgentText block md={`\`\`\`bash\n${curl}\n\`\`\``}>
                  <CopyCommand
                    command={curl}
                    label="Copy curl command"
                    className="w-fit max-w-full"
                  >
                    curl -H &apos;Accept:{' '}
                    <span className="text-(--agent)">application/vnd.afford+json</span>&apos;{' '}
                    {siteUrl.host}
                  </CopyCommand>
                </AgentText>
              </div>
            </div>
          </section>

          <section
            className={cn(sec, 'flex flex-col items-start')}
            id="start"
            aria-labelledby="h-cta"
          >
            <h2
              id="h-cta"
              className="max-w-[820px] text-[clamp(44px,6vw,72px)] leading-[1.02] font-semibold tracking-[-0.055em] text-balance"
            >
              Your UI is the API.
            </h2>
            <p className="mt-5 max-w-[620px] text-lg leading-[1.6] text-pretty text-(--fg2)">
              Add Afford to an existing Next.js app. Start with one route.
            </p>
            <AgentText block md={'```bash\nvlx @afford/next init\n```'}>
              <CopyCommand
                className="mt-8 w-[440px] max-w-full"
                command={Object.fromEntries(
                  packageManagers.map((pm) => [pm, exec(pm, '@afford/next init')]),
                )}
                label="Copy install command"
              />
            </AgentText>
            <div className="mt-4 flex flex-wrap gap-2.5">
              <Button asChild className={btn}>
                <Link href="/docs/quickstart">Get started</Link>
              </Button>
              <Button asChild variant="outline" className={btn}>
                <Link href="/docs">Read the docs</Link>
              </Button>
            </div>
          </section>
        </main>
      </AgentMain>
    </div>
  )
}

export default Home

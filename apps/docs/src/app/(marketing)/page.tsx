import type { Metadata } from 'next'
import Link from 'next/link'
import { cn } from 'cn'
import { mdAlternate } from '@affordances/md/next'
import { AgentMain, AgentText } from '@affordances/md/react'
import { Button } from '@/components/ui/button'
import { After, Before } from '@/components/marketing/scrolly'
import { Code, SectionHead } from '@/components/marketing/section-head'
import { Approvals } from '@/components/marketing/approvals'
import { CopyCommand } from '@/components/marketing/copy-command'
import { HeroStage } from '@/components/marketing/hero-stage'
import { HowItWorks, SOURCE, SURFACES } from '@/components/marketing/how'
import { Proof } from '@/components/marketing/proof'
import { benchRuns, modelName, type BenchRun } from '@/lib/bench'
import { siteUrl } from '@/lib/site-url'

export const metadata: Metadata = {
  title: { absolute: 'Affordances: every page, agent-operable' },
  description:
    'Your UI already knows what it can do. Affordances lets you declare it once, and humans, browser agents, headless agents, and MCP clients all use the same definition.',
  alternates: { canonical: '/', ...mdAlternate('/') },
}

const int = (n: number) => Math.round(n).toLocaleString('en-US')
const sec1 = (ms: number) => `${(ms / 1000).toFixed(1)}s`
const usd = (n?: number) =>
  n === undefined
    ? '–'
    : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumSignificantDigits: 2 })

// the proof section for agents: each model's medians, then every task, from the same results files
const proofMd = (runs: BenchRun[]) =>
  runs
    .map((r) => {
      const { browser: b, afford: a } = r
      const ok = (x: { successRate: number }) => Math.round(x.successRate * r.runs)
      return [
        `**${modelName(r.model)}**, ${r.runs} runs per task. Median per task, browser agent against Affordances agent: ${int(b.tokens)} against ${int(a.tokens)} tokens, ${sec1(b.ms)} against ${sec1(a.ms)}, ${b.turns} against ${a.turns} steps, ${usd(b.costPerSuccessUsd)} against ${usd(a.costPerSuccessUsd)} per successful task. Tasks completed: ${Math.round(b.successRate * 100)}% against ${Math.round(a.successRate * 100)}%.`,
        '| Task | Browser tokens | Affordances tokens | Browser time | Affordances time | Browser passed | Affordances passed |\n| --- | --: | --: | --: | --: | --: | --: |\n' +
          r.tasks
            .map(
              (t) =>
                `| ${t.name} | ${int(t.browser.tokens)} | ${int(t.afford.tokens)} | ${sec1(t.browser.ms)} | ${sec1(t.afford.ms)} | ${ok(t.browser)}/${r.runs} | ${ok(t.afford)}/${r.runs} |`,
            )
            .join('\n'),
      ].join('\n\n')
    })
    .join('\n\n')

const PRINCIPLES: {
  t: string
  d: string
  lang: string
  proof: [React.ReactNode, React.ReactNode]
  md: string
}[] = [
  {
    t: 'Signal, not pixels.',
    d: 'An agent reads names, inputs and preconditions from the graph. No screenshots, no guessing which button does what.',
    lang: 'json',
    proof: [
      <>
        <span className="text-(--fg3)">&quot;guard&quot;:</span> &quot;The variant is in stock&quot;
      </>,
      <>
        <span className="text-(--fg3)">&quot;available&quot;:</span>{' '}
        <span className="text-(--agent)">true</span>
      </>,
    ],
    md: '"guard": "The variant is in stock",\n"available": true',
  },
  {
    t: 'One source, no drift.',
    d: 'Every surface reads the same definition, so one edit reaches all of them. There is no second copy to forget.',
    lang: 'text',
    proof: [
      <>
        actions.ts <span className="text-(--fg3)">|</span> 2{' '}
        <span className="text-(--fg3)">+-</span>
      </>,
      <>
        <span className="text-(--agent)">→</span> form, WebMCP, HTTP, MCP
      </>,
    ],
    md: 'actions.ts | 2 +-\n→ form, WebMCP, HTTP, MCP',
  },
  {
    t: 'Agents act, humans approve.',
    d: 'Actions without expose stay invisible to agents. Mark one confirm, and an agent can prepare it but only a person can finish it.',
    lang: 'ts',
    proof: [
      <>
        expose: <span className="text-(--agent)">&apos;confirm&apos;</span>
      </>,
      <>
        <span className="text-(--fg3)">←</span> 409 confirm_required
      </>,
    ],
    md: "expose: 'confirm'\n// ← 409 confirm_required",
  },
]

const ENTRY = [
  { href: '/llms.txt', d: 'Every page on this site, indexed' },
  { href: '/index.md', d: 'This page, as text/markdown' },
  { href: '/agents', d: 'Where an agent should start' },
]

const sec = 'relative px-14 py-24 max-[899px]:px-5 max-[899px]:py-[72px]'
const btn = 'h-11 rounded-lg px-[18px] text-sm active:scale-[0.97]'

const Dot = ({ agent }: { agent?: boolean }) => (
  <span
    className={cn('size-[7px] flex-none rounded-full', agent ? 'bg-(--agent)' : 'bg-(--fg3)')}
  />
)

const curl = `curl -H 'Accept: application/vnd.affordances+json' ${siteUrl.origin}`

const Home = () => {
  const runs = benchRuns()
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
                Your UI already knows what it can do. Affordances lets you declare it once. Humans,
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
              md="**One URL, two readers.** A product page, a team settings page, and a booking page, each shown as a person sees it (`text/html`) and as the graph an agent reads (`application/vnd.affordances+json`) at the same URL: its entities, its action with input, guard, and availability, and its nav. Calling the action returns a delta with only what changed."
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
                  Agent · application/vnd.affordances+json
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
              md={`After, with Affordances\n\n## Three files per route. One definition.\n\n\`page.tsx\` renders. \`state.ts\` says what's on the page. \`actions.ts\` says what can be done. Every agent surface (server action, WebMCP, HTTP graph, MCP, Markdown) is derived from those, so one edit reaches all of them. The agent finishes in five calls: read the graph, add to cart, read the checkout, then place the order, once to get the confirmation summary and once with \`confirm: true\`.`}
            >
              <After />
            </AgentText>
          </section>

          <section className={sec} id="how" aria-labelledby="h-how">
            <SectionHead eyebrow="How it works" id="h-how" title="Declare it next to the page.">
              An action is a server action with a schema, an exposure level and a list of what it
              changes. Pick a surface to see what the same definition becomes.
            </SectionHead>
            <AgentText
              block
              md={`\`\`\`ts\n${SOURCE}\n\`\`\`\n\nOne \`defineAction\`, five surfaces:\n\n${SURFACES.map((f) => `- **${f.name}** (${f.who}): ${f.note}`).join('\n')}`}
            >
              <HowItWorks />
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
                "```ts\nexport const placeOrder = defineAction({\n  name: 'placeOrder',\n  expose: 'confirm',\n  run: (input, ctx) => orders.place(ctx.session.id),\n})\n```\n\nAn agent's first call answers `409 confirm_required` with a summary (\"Place order · $244.00\"). Nothing runs until the person approves. Then the agent sends the call again with `confirm: true` and gets the delta back: the emptied cart and a redirect to the orders page. If the person declines, nothing is charged and the agent doesn't call again."
              }
            >
              <Approvals />
            </AgentText>
          </section>

          <section className={sec} id="proof" aria-labelledby="h-proof">
            <SectionHead eyebrow="Proof" id="h-proof" title="Measured, not claimed.">
              The same shopping tasks on the same model: a browser agent reading accessibility
              snapshots, against an Affordances agent reading the graph.{' '}
              {runs.length ? (
                <>
                  From the latest committed runs; the{' '}
                  <Link
                    href="/docs/benchmarks"
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
            {runs.length > 0 && (
              <AgentText block md={proofMd(runs)}>
                <Proof runs={runs.map((r) => ({ ...r, name: modelName(r.model) }))} />
              </AgentText>
            )}
          </section>

          <section className={sec} aria-labelledby="h-pr">
            <SectionHead eyebrow="Principles" id="h-pr" title="Three rules it doesn’t bend." />
            <ol className="grid grid-cols-3 border-t border-(--line) max-[899px]:grid-cols-1">
              {PRINCIPLES.map((p, i) => (
                <li
                  key={p.t}
                  className="flex flex-col gap-3 border-l border-(--line) px-6 pt-7 pb-2 first:border-l-0 first:pl-0 last:pr-0 max-[899px]:border-b max-[899px]:border-l-0 max-[899px]:px-0 max-[899px]:pb-7"
                >
                  <span aria-hidden className="font-pixel text-sm text-(--fg3)">
                    0{i + 1}
                  </span>
                  <h3 className="text-[22px] leading-tight font-semibold tracking-[-0.03em] text-balance">
                    {p.t}
                  </h3>
                  <p className="text-[15px] leading-relaxed text-pretty text-(--fg2)">{p.d}</p>
                  <AgentText block md={`\`\`\`${p.lang}\n${p.md}\n\`\`\``}>
                    <div className="mt-auto rounded-lg border border-(--line) bg-(--bg2) px-3.5 py-3 font-mono text-[12.5px] leading-[1.7] whitespace-nowrap text-(--fg)">
                      {p.proof.map((line, j) => (
                        <div key={j} className="overflow-hidden text-ellipsis">
                          {line}
                        </div>
                      ))}
                    </div>
                  </AgentText>
                </li>
              ))}
            </ol>

            <AgentText
              block
              md={`**Reading this as an agent?** Skip the pixels: every page here is also Markdown and a graph. Start at [/llms.txt](${siteUrl.origin}/llms.txt), read this page at [/index.md](${siteUrl.origin}/index.md), or see [/agents](${siteUrl.origin}/agents).\n\n\`\`\`bash\n${curl}\n\`\`\``}
            >
              <div
                id="agents"
                className="mt-20 grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] overflow-hidden rounded-2xl border border-(--line2) bg-(--bg2) max-[899px]:mt-14 max-[899px]:grid-cols-1"
              >
                <div className="flex min-w-0 flex-col gap-4 p-8 max-[599px]:p-5">
                  <p className="flex items-center gap-2 font-pixel text-sm text-(--agent)">
                    <Dot agent />
                    For agents
                  </p>
                  <h3 className="text-[26px] leading-tight font-semibold tracking-[-0.03em]">
                    Reading this as an agent?
                  </h3>
                  <p className="max-w-[440px] text-[15px] leading-relaxed text-pretty text-(--fg2)">
                    Skip the pixels. Every page here is also Markdown and a graph, at the same URL.
                  </p>
                  <CopyCommand
                    command={curl}
                    label="Copy curl command"
                    className="mt-2 w-full max-w-full bg-(--bg)"
                  >
                    curl -H &apos;Accept:{' '}
                    <span className="text-(--agent)">application/vnd.affordances+json</span>&apos;{' '}
                    {siteUrl.origin}
                  </CopyCommand>
                </div>
                <ul className="flex flex-col border-l border-(--line) max-[899px]:border-t max-[899px]:border-l-0">
                  {ENTRY.map((e) => (
                    <li key={e.href} className="flex-1 border-t border-(--line) first:border-t-0">
                      <Link
                        href={e.href}
                        prefetch={false}
                        className="group flex h-full min-h-16 items-center gap-4 px-6 transition-colors duration-150 hover:bg-(--bg3)/60 focus-visible:-outline-offset-2 max-[599px]:px-5"
                      >
                        <span className="flex min-w-0 flex-col gap-1">
                          <span className="font-mono text-sm text-(--agent)">{e.href}</span>
                          <span className="text-[13px] text-(--fg3)">{e.d}</span>
                        </span>
                        <span
                          aria-hidden
                          className="ml-auto font-mono text-(--fg3) transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-(--fg)"
                        >
                          →
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </AgentText>
          </section>
        </main>
      </AgentMain>
    </div>
  )
}

export default Home

'use client'

import { cn } from 'cn'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@affordances/ui/components/dialog'
import type { Listing } from '@/lib/recordings'
import { agentsOf, EFFORT, kb, LANE, modelName, NAMES, type DemoEvent } from '@/lib/race'

const H = ({ children }: { children: React.ReactNode }) => (
  <h3 className="font-pixel text-sm text-muted-foreground">{children}</h3>
)

const Facts = ({ items }: { items: React.ReactNode[] }) => (
  <ul className="mt-3 flex flex-col gap-2 text-[15px] leading-relaxed text-pretty text-foreground/85">
    {items.map((item, i) => (
      <li key={i} className="flex gap-3">
        <span aria-hidden className="mt-[0.7em] size-1 shrink-0 rounded-full bg-muted-foreground" />
        <span>{item}</span>
      </li>
    ))}
  </ul>
)

const Code = ({ children }: { children: React.ReactNode }) => (
  <code className="rounded-[5px] bg-muted px-[5px] py-px font-mono text-[0.86em]">{children}</code>
)

// how the race was run and what makes it fair, then what each model was handed before the task: its system
// prompt (the affordances agent's carries the site index; the webmcp agent's one sentence about page
// tools) and its tools
export const Methodology = ({
  open,
  onOpenChange,
  events,
  recording,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  events: DemoEvent[]
  // null for a live run, which isn't saved
  recording: Listing | null
}) => {
  const run = events.find((e) => e.type === 'run')
  const agents = agentsOf(events)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] gap-8 overflow-y-auto p-8 text-[15px] sm:max-w-6xl">
        <div>
          <DialogTitle className="text-3xl font-semibold tracking-[-0.03em]">
            Methodology
          </DialogTitle>
          <DialogDescription className="mt-2 max-w-3xl text-[15px] leading-relaxed text-pretty">
            One recorded run per race. Model latency varies from run to run, so treat one race as an
            illustration; the medians over five runs per task are on the docs site’s Benchmarks page
            (<Code>/docs/benchmarks</Code>).
          </DialogDescription>
        </div>

        <div className="grid gap-x-10 gap-y-8 md:grid-cols-2">
          <section>
            <H>How it ran</H>
            <Facts
              items={[
                <>
                  Every agent runs{' '}
                  <span className="text-foreground">{modelName(run?.model ?? '')}</span> at{' '}
                  <Code>{EFFORT}</Code> effort, gets the same task message, and starts on its own
                  empty session of the same fresh store.
                </>,
                'All agents start together, on one clock. Times are wall-clock, model calls included.',
                agents.includes('vision')
                  ? 'Only the screenshot agent’s model sees screenshots; for every other lane they’re for you. A browser agent’s come from its own page, the Affordances agent’s from an observer browser on its session.'
                  : 'The screenshots are for you; no model ever sees one. A browser agent’s come from its own page, the Affordances agent’s from an observer browser on its session.',
                <>
                  Tokens are everything the model read and wrote, cache reads included; cost is list
                  price.
                </>,
              ]}
            />
          </section>
          <section>
            <H>How success is checked</H>
            <Facts
              items={[
                'Against the store, not the agent’s word: the cart and orders of the agent’s own session after it stops.',
                'For the two questions (search, order status), the answer must name the right product and price.',
                'A refusal or 40 turns without finishing counts as a failure.',
              ]}
            />
          </section>
          <section>
            <H>Fairness</H>
            <Facts
              items={[
                'The browser agent reads accessibility snapshots, far cheaper than screenshots: a generous baseline.',
                <>
                  It selects radios and checkboxes with Playwright’s <Code>check()</Code>, the way a
                  person clicks a styled label.
                </>,
                'It never sees the store’s Agent view toggle, a demo-only control that would hand it the graph.',
                ...(agents.includes('vision')
                  ? [
                      'The screenshot agent is Claude’s computer use toolset on a 1280×800 Chromium, plus goto to open a path, as the snapshot agent has. It is how most browser agents work today.',
                    ]
                  : []),
                <>
                  WebMCP: no shipping Chromium has <Code>registerTool</Code> yet, so the WebMCP
                  browser is a shim. Its system prompt adds one neutral sentence; it is never told
                  about Affordances.
                </>,
              ]}
            />
          </section>
          <section>
            <H>This recording</H>
            {recording ? (
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[15px]">
                <dt className="text-muted-foreground">File</dt>
                <dd className="font-mono text-[13px] break-all">{recording.file}</dd>
                <dt className="text-muted-foreground">Recorded</dt>
                <dd>{new Date(recording.startedAt).toLocaleString('en-US')}</dd>
                <dt className="text-muted-foreground">Commit</dt>
                <dd className="font-mono text-[13px]">
                  {recording.commit
                    ? `${recording.commit.sha}, ${recording.commit.date}`
                    : 'not committed yet'}
                </dd>
              </dl>
            ) : (
              <p className="mt-3 text-muted-foreground">
                A live run, streamed as it happened. It isn’t saved.
              </p>
            )}
          </section>
        </div>

        <section>
          <H>What each agent is told before the task</H>
          <p className="mt-2 text-[15px] text-muted-foreground">
            Then each gets the same message:{' '}
            <span className="text-foreground">“{run?.task.prompt}”</span>
          </p>
          <div className="mt-5 grid gap-8 md:grid-cols-2">
            {agents.map((agent) => {
              const setup = events.find((e) => e.type === 'agent' && e.agent === agent)
              if (setup?.type !== 'agent') return null
              // tools pages registered along the way (WebMCP): never in the prompt, only in the toolbox
              const builtins = new Set(setup.tools.map((tool) => tool.name))
              const page = [
                ...new Set(
                  events.flatMap((e) =>
                    e.type === 'turn' && e.agent === agent
                      ? (e.tools ?? []).filter((name) => !builtins.has(name))
                      : [],
                  ),
                ),
              ]
              return (
                <div key={agent} className={cn('flex min-w-0 flex-col gap-4', LANE[agent])}>
                  <h4 className="flex items-center gap-2.5 text-lg font-medium">
                    <span aria-hidden className="size-2.5 rounded-full bg-(--lane)" />
                    {NAMES[agent]}
                  </h4>
                  <div>
                    <p className="flex justify-between font-mono text-[12px] text-muted-foreground">
                      System prompt <span>{kb(setup.system.length)}</span>
                    </p>
                    <pre className="mt-1.5 max-h-[36dvh] overflow-auto rounded-lg border bg-background p-3 font-mono text-xs/[1.6] whitespace-pre-wrap text-muted-foreground">
                      {setup.system}
                    </pre>
                  </div>
                  <div>
                    <p className="font-mono text-[12px] text-muted-foreground">Tools</p>
                    <ul className="mt-1.5 flex flex-col divide-y rounded-lg border">
                      {setup.tools.map((tool) => (
                        <li key={tool.name} className="px-3 py-2.5">
                          <p className="font-mono text-[14px] font-medium">{tool.name}</p>
                          <p className="mt-0.5 text-[14px] text-pretty text-muted-foreground">
                            {tool.description}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </div>
                  {page.length > 0 && (
                    <div>
                      <p className="font-mono text-[12px] text-muted-foreground">
                        Registered by pages during the run, in the toolbox only while on that page
                      </p>
                      <p className="mt-1.5 flex flex-wrap gap-1.5 font-mono text-[14px]">
                        {page.map((name) => (
                          <span key={name} className="rounded-md bg-afford/15 px-1.5 text-afford">
                            {name}
                          </span>
                        ))}
                      </p>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      </DialogContent>
    </Dialog>
  )
}

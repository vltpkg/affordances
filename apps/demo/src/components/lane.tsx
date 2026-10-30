'use client'

import { cn } from 'cn'
import { CheckIcon, XIcon } from 'lucide-react'
import {
  callLabel,
  firstLine,
  int,
  byKind,
  kb,
  LANE,
  NAMES,
  plain,
  sec,
  usd,
  type Lane as LaneState,
  type Step,
} from '@/lib/race'

const ABOUT = byKind(
  {
    browser: 'Drives Chromium. Reads accessibility snapshots, clicks by role and name.',
    afford: 'Reads the page graph. Calls actions by name. Has no browser.',
    webmcp: 'The same browser agent. Its browser offers tools the page registers.',
    vision: 'Claude computer use. Sees only screenshots, clicks by coordinates.',
  },
  () => 'An agent kind this demo doesn’t describe yet.',
)

// what lands in "what the model reads", before anything has
const READS = byKind(
  {
    browser: 'the accessibility snapshot of the page, after every step',
    afford: 'the page graph as JSON, or an action’s delta',
    webmcp: 'the accessibility snapshot of the page, or a page tool’s result',
    vision: 'a screenshot (shown as [image]), or OK after an action',
  },
  () => 'its tool results',
)

type Props = {
  lane: LaneState
  t: number
  // the meter's full width, the same for both lanes
  scale: number
  // the other lane finished this long ago (it's ahead), or null
  behind: number | null
  started: boolean
  // three lanes side by side (xl and up): one column of panels, counters under the headline numbers
  compact?: boolean
}

// top-down: who the agent is and what it has, the headline numbers, the counters, then three labelled
// panels (what a person sees, what the model reads, its steps)
export const Lane = ({ lane, t, scale, behind, started, compact }: Props) => {
  const { agent, activity } = lane
  const done = activity.kind === 'done' ? activity.done : null
  return (
    <section
      aria-labelledby={`${agent}-name`}
      className={cn(
        'relative flex min-h-0 min-w-0 flex-col bg-background px-6 pt-5 pb-5',
        compact && 'xl:px-5',
        LANE[agent],
      )}
    >
      {/* the finish: the lane rings once in its colour as it resolves */}
      {done && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 animate-finish opacity-0 ring-2 ring-(--lane) ring-inset"
        />
      )}
      <header className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <h2
            id={`${agent}-name`}
            className="flex items-center gap-2.5 text-2xl font-semibold tracking-[-0.02em]"
          >
            <span aria-hidden className="size-2.5 rounded-full bg-(--lane)" />
            {NAMES[agent]}
          </h2>
          {!done && <Status lane={lane} t={t} started={started} />}
        </div>
        <p
          title={ABOUT[agent]}
          className={cn(
            'mt-1 text-[15px] text-pretty text-muted-foreground',
            compact && 'xl:truncate',
          )}
        >
          {ABOUT[agent]}
        </p>
        <Toolbox lane={lane} />
      </header>

      <div
        className={cn(
          'mt-3 flex flex-wrap items-end justify-between gap-x-8 gap-y-3 border-t pt-3',
          compact && 'xl:flex-nowrap xl:gap-x-4',
        )}
      >
        <div className="min-w-0">
          <p className="font-mono text-[12px] text-muted-foreground">
            {done ? 'Finished in' : 'Elapsed'}
          </p>
          <p className="mt-1 flex items-center gap-3 2xl:gap-4">
            <span
              className={cn(
                'font-mono text-4xl font-medium tracking-[-0.04em] tabular-nums',
                compact ? '2xl:text-5xl' : '2xl:text-6xl',
                done && (done.success ? 'text-(--lane)' : 'text-fail'),
              )}
            >
              {sec(lane.elapsed)}
            </span>
            {behind !== null && (
              <span className="font-mono text-xl text-fail tabular-nums 2xl:text-2xl">
                +{sec(behind)}
              </span>
            )}
            {done && <Status lane={lane} t={t} started={started} />}
          </p>
        </div>
        <dl
          className={cn(
            'grid grid-cols-4 gap-x-5 2xl:gap-x-6',
            compact && 'xl:grid-cols-2 xl:gap-y-1 xl:[&_dd]:text-lg',
          )}
        >
          <Stat label="Turns">{lane.turns}</Stat>
          <Stat label="Tool calls">
            {lane.toolCalls}
            {lane.errors > 0 && <span className="ml-1 text-[15px] text-fail">{lane.errors}✗</span>}
          </Stat>
          <Stat label="Tokens">{int(lane.tokens)}</Stat>
          <Stat label="Cost">{lane.costUsd === null ? '—' : usd(lane.costUsd)}</Stat>
        </dl>
      </div>

      <Meter steps={lane.steps} scale={scale} />

      {/* stacked lanes (narrower than xl) scroll the page, so the panels get a height of their own */}
      <div
        className={cn(
          'mt-4 grid min-h-0 flex-1 gap-4 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] max-xl:md:h-[34rem]',
          // three lanes: the page across the top, what the model reads and its steps side by side below
          compact && 'xl:grid-cols-2 xl:grid-rows-[minmax(0,1fr)_minmax(0,1.15fr)] xl:gap-3',
        )}
      >
        <div className={cn('flex min-h-0 flex-col gap-4', compact && 'xl:contents')}>
          <Viewport lane={lane} className={cn(compact && 'xl:col-span-2')} />
          <Reads lane={lane} />
        </div>
        <Panel label="Steps" aside={lane.turns ? `${lane.turns} turns` : null}>
          <Timeline lane={lane} t={t} />
        </Panel>
      </div>
    </section>
  )
}

// a labelled box: the label sits above it, like a figure caption, so an empty box still says what it's for
const Panel = ({
  label,
  aside,
  className,
  children,
}: {
  label: string
  aside?: React.ReactNode
  className?: string
  children: React.ReactNode
}) => (
  <div className={cn('flex min-h-0 min-w-0 flex-col', className)}>
    <p className="mb-1.5 flex items-baseline justify-between gap-3 font-mono text-[12px] text-muted-foreground">
      <span className="shrink-0 text-foreground/80">{label}</span>
      {aside && <span className="min-w-0 truncate">{aside}</span>}
    </p>
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border">{children}</div>
  </div>
)

const Empty = ({ children }: { children: React.ReactNode }) => (
  <p className="m-auto max-w-[34ch] p-4 text-center text-[14px] text-pretty text-muted-foreground">
    {children}
  </p>
)

// what the model can call right now. built-ins are plain; a tool the page registered (WebMCP) slides in,
// orange because it's an affordances action, and one the last navigation took away stays struck through
const Toolbox = ({ lane }: { lane: LaneState }) => {
  const page = lane.toolbox.filter((name) => !lane.builtins.has(name))
  const lost = lane.lost.filter((name) => !lane.builtins.has(name))
  return (
    <ul
      aria-label="Tools the model has"
      className="mt-2 flex flex-wrap items-center gap-1.5 font-mono text-[14px]"
    >
      {lane.toolbox
        .filter((name) => lane.builtins.has(name))
        .map((name) => (
          <li key={name} className="rounded-md border px-1.5 text-muted-foreground">
            {name}
          </li>
        ))}
      {page.map((name) => (
        <li
          key={name}
          className="animate-tool-in rounded-md bg-afford/15 px-1.5 font-medium text-afford ring-1 ring-afford/60 ring-inset"
        >
          <span className="sr-only">new from the page: </span>+ {name}
        </li>
      ))}
      {page.length > 0 && <li className="font-sans text-[13px] text-afford/80">from this page</li>}
      {lost.map((name) => (
        <li
          key={`lost-${name}`}
          className="animate-tool-out px-1 text-muted-foreground/60 line-through decoration-muted-foreground"
        >
          <span className="sr-only">gone after navigating: </span>
          {name}
        </li>
      ))}
    </ul>
  )
}

// a turn's toolbox against the one before it: what the page added, and what leaving a page took away
const Change = ({ added, lost }: { added: string[]; lost: string[] }) =>
  added.length + lost.length > 0 && (
    <p className="mt-1.5 flex flex-wrap items-center gap-1.5 font-mono text-[13px]">
      {added.map((name) => (
        <span key={name} className="rounded-md bg-afford/15 px-1.5 text-afford">
          + {name}
        </span>
      ))}
      {added.length > 0 && (
        <span className="font-sans text-muted-foreground">new from the page</span>
      )}
      {lost.map((name) => (
        <span key={name} className="px-1 text-muted-foreground line-through">
          {name}
        </span>
      ))}
      {!added.length && <span className="font-sans text-muted-foreground">gone with the page</span>}
    </p>
  )

const diff = (before: string[], after: string[], builtins: Set<string>) => ({
  added: after.filter((n) => !before.includes(n) && !builtins.has(n)),
  lost: before.filter((n) => !after.includes(n) && !builtins.has(n)),
})

const Stat = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="min-w-0">
    <dt className="font-mono text-[12px] whitespace-nowrap text-muted-foreground">{label}</dt>
    <dd className="mt-0.5 font-mono text-xl font-medium whitespace-nowrap tabular-nums 2xl:text-2xl">
      {children}
    </dd>
  </div>
)

const Status = ({ lane, t, started }: { lane: LaneState; t: number; started: boolean }) => {
  const { activity } = lane
  if (activity.kind === 'done') {
    const { success } = activity.done
    return (
      <span
        className={cn(
          'flex shrink-0 animate-stamp items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium text-black 2xl:text-[15px]',
          success ? 'bg-(--lane)' : 'bg-fail',
        )}
      >
        {success ? <CheckIcon className="size-4" /> : <XIcon className="size-4" />}
        {success ? 'Done' : 'Failed'}
      </span>
    )
  }
  if (!started) return null
  const label =
    activity.kind === 'tool' ? callLabel(activity.call.name, activity.call.input).verb : 'thinking'
  return (
    <span className="flex shrink-0 items-center gap-2 rounded-full border px-2.5 py-1 font-mono text-sm 2xl:text-[15px]">
      <span aria-hidden className="size-2 animate-breathe rounded-full bg-(--lane)" />
      {label}
      <span className="text-muted-foreground tabular-nums">{sec(t - activity.since)}</span>
    </span>
  )
}

// every turn re-reads the whole conversation so far: one segment per turn, the same scale on both lanes
const Meter = ({ steps, scale }: { steps: Step[]; scale: number }) => (
  <div className="mt-3 flex items-center gap-3">
    <div
      aria-hidden
      className="flex h-2 min-w-0 flex-1 gap-px overflow-hidden rounded-full bg-muted"
    >
      {steps.map((step) => (
        <span
          key={step.turn}
          className="h-full origin-left animate-enter bg-(--lane) even:opacity-75"
          style={{ width: `${(step.tokens / scale) * 100}%` }}
        />
      ))}
    </div>
    <span className="shrink-0 font-mono text-[12px] text-muted-foreground">
      tokens, turn by turn
    </span>
  </div>
)

const Viewport = ({ lane, className }: { lane: LaneState; className?: string }) => {
  const { frame, agent } = lane
  const url = frame ? new URL(frame.url) : null
  return (
    <Panel
      label="What a person sees"
      // the vision agent works from screenshots, so for it this panel is the model's input too
      aside={agent === 'vision' ? 'the model sees screenshots too' : 'never shown to the model'}
      className={cn('shrink-0 grow-0 basis-[48%] max-md:basis-auto', className)}
    >
      <div className="flex h-8 items-center border-b px-3 font-mono text-[13px]">
        <span className="truncate">
          {url ? (
            <>
              <span className="text-muted-foreground">{url.host}</span>
              {url.pathname}
              {url.search}
            </>
          ) : (
            <span className="text-muted-foreground">about:blank</span>
          )}
        </span>
      </div>
      <div className="relative grid min-h-0 flex-1 bg-muted/30 max-md:aspect-[16/10]">
        {frame ? (
          // a data url from the recording: there's nothing for next/image to optimize
          // oxlint-disable-next-line nextjs/no-img-element
          <img
            key={frame.id}
            src={frame.image}
            alt={`What a person would see at ${url?.pathname}`}
            className="absolute inset-0 size-full animate-enter object-cover object-top"
          />
        ) : (
          <Empty>The store appears here once the agent opens a page.</Empty>
        )}
      </div>
    </Panel>
  )
}

// a 1280x800 screenshot: ⌈1280/28⌉ × ⌈800/28⌉ image tokens
const SCREENSHOT_TOKENS = 1334

const Reads = ({ lane }: { lane: LaneState }) => {
  const { read, frame } = lane
  const label = read && callLabel(read.name, read.input)
  // the screenshot agent reads the screenshot itself; the recording keeps it as the frame, not the result
  const image = read?.result === '[image]' ? frame : undefined
  return (
    <Panel
      label="What the model reads"
      aside={
        read && (
          <span
            className={cn('font-mono tabular-nums', read.error ? 'text-fail' : 'text-foreground')}
          >
            {read.error
              ? 'error'
              : image
                ? `≈${(SCREENSHOT_TOKENS / 1000).toFixed(1)}k image tokens`
                : kb(read.result.length)}
          </span>
        )
      }
      className="flex-1 max-md:h-72"
    >
      {read ? (
        <>
          <p className="flex h-8 shrink-0 items-center border-b px-3 font-mono text-[13px]">
            <span className="min-w-0 truncate">
              ← {label!.verb} <span className="text-muted-foreground">{label!.arg}</span>
            </span>
          </p>
          {image ? (
            <div className="relative min-h-0 flex-1 bg-muted/30">
              {/* oxlint-disable-next-line nextjs/no-img-element */}
              <img
                key={read.id}
                src={image.image}
                alt="The screenshot the model reads"
                className="absolute inset-0 size-full animate-enter object-contain"
              />
            </div>
          ) : (
            /* raw, exactly as the model gets it on its next turn */
            <pre
              key={read.id}
              aria-label="Latest tool result"
              className={cn(
                'min-h-0 flex-1 animate-enter overflow-auto p-3 font-mono text-xs/[1.55] whitespace-pre-wrap [overflow-wrap:anywhere]',
                read.error ? 'bg-fail/10 text-fail' : 'text-muted-foreground',
              )}
            >
              {plain(read.result)}
            </pre>
          )}
        </>
      ) : (
        <Empty>
          Each tool result lands here raw, exactly as the model reads it: {READS[lane.agent]}.
        </Empty>
      )}
    </Panel>
  )
}

const Timeline = ({ lane, t }: { lane: LaneState; t: number }) => {
  const { steps, activity, builtins } = lane
  const base = [...builtins]
  const offered = (i: number) => steps[i]?.offered ?? base
  // the turn in flight already has its toolbox: a page tool the model is thinking with shows here first
  const thinking = activity.kind === 'thinking' && t > 0 ? activity : null
  const coming = diff(steps.length ? offered(steps.length - 1) : base, lane.toolbox, builtins)
  // column-reverse pins the scroll to the newest row with no script, and without animating it: rows
  // arrive often
  return (
    <div className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto p-3 max-md:max-h-96">
      {!steps.length && !thinking && (
        <Empty>
          Every turn shows up here: how long the model thought, the tools it called, and how long
          each took.
        </Empty>
      )}
      <ol aria-label={`${NAMES[lane.agent]} timeline`} className="mb-auto flex flex-col gap-3">
        {steps.map((step, i) => {
          const pending = i === steps.length - 1 && activity.kind === 'tool' ? activity : null
          return (
            <li key={step.turn} className="animate-enter">
              <p className="flex items-baseline gap-2 text-[13px] text-muted-foreground">
                <span className="font-mono text-foreground">Turn {step.turn}</span>
                <span>thought {sec(step.ms)}</span>
                <span className="ml-auto font-mono tabular-nums">{int(step.tokens)} tok</span>
              </p>
              {step.offered && (
                <Change {...diff(i ? offered(i - 1) : base, step.offered, builtins)} />
              )}
              {step.text && (
                <p className="mt-1 text-[14px]/snug text-pretty text-foreground/90">{step.text}</p>
              )}
              {(step.results.length > 0 || pending) && (
                <ul className="mt-1.5 flex flex-col gap-1">
                  {step.results.map((tool) => (
                    <ToolRow
                      key={tool.id}
                      name={tool.name}
                      input={tool.input}
                      ms={tool.ms}
                      error={tool.error}
                      page={lane.offered.includes(tool.name)}
                    />
                  ))}
                  {pending && (
                    <ToolRow
                      name={pending.call.name}
                      input={pending.call.input}
                      ms={t - pending.since}
                      page={lane.offered.includes(pending.call.name)}
                      pending
                    />
                  )}
                </ul>
              )}
            </li>
          )
        })}
        {thinking && (
          <li>
            <p className="flex items-center gap-2 font-mono text-[14px] text-muted-foreground">
              <span aria-hidden className="size-2 animate-breathe rounded-full bg-(--lane)" />
              thinking
              <span className="ml-auto tabular-nums">{sec(t - thinking.since)}</span>
            </p>
            <Change {...coming} />
          </li>
        )}
        {activity.kind === 'done' && (
          <li
            className={cn(
              'flex animate-stamp items-center gap-2 border-t pt-3 text-[15px] font-medium',
              activity.done.success ? 'text-(--lane)' : 'text-fail',
            )}
          >
            {activity.done.success ? (
              <CheckIcon className="size-4" />
            ) : (
              <XIcon className="size-4" />
            )}
            {activity.done.success ? 'Task done' : 'Task not done'} in {sec(activity.done.at)}
          </li>
        )}
      </ol>
    </div>
  )
}

const ToolRow = ({
  name,
  input,
  ms,
  error,
  page,
  pending,
}: {
  name: string
  input: unknown
  ms: number
  error?: string
  // a tool the page registered: one call where a browser would click its way through the form
  page?: boolean
  pending?: boolean
}) => {
  const { verb, arg } = callLabel(name, input)
  return (
    <li
      className={cn(
        'animate-enter rounded-md px-2 py-1 font-mono text-[14px]',
        error
          ? 'bg-fail/12 text-fail'
          : page
            ? 'bg-afford/12 ring-1 ring-afford/50 ring-inset'
            : 'bg-muted/60',
      )}
    >
      <div className="flex items-baseline gap-2">
        {pending ? (
          <span
            aria-hidden
            className="size-2 shrink-0 animate-breathe self-center rounded-full bg-(--lane)"
          />
        ) : error ? (
          <XIcon aria-hidden className="size-3.5 shrink-0 self-center" />
        ) : (
          <CheckIcon aria-hidden className="size-3.5 shrink-0 self-center text-muted-foreground" />
        )}
        <span className={cn('font-medium', page && !error && 'text-afford')}>
          {page && <span className="sr-only">page tool </span>}
          {verb}
        </span>
        <span className={cn('min-w-0 truncate', !error && 'text-muted-foreground')}>{arg}</span>
        <span
          className={cn(
            'ml-auto shrink-0 tabular-nums',
            !error && (ms >= 1000 ? 'text-foreground' : 'text-muted-foreground'),
          )}
        >
          {ms < 1000 ? `${Math.round(ms)}ms` : sec(ms)}
        </span>
      </div>
      {error && <p className="mt-0.5 truncate pl-5.5 text-[13px]">{firstLine(error)}</p>}
    </li>
  )
}

'use client'

import { cn } from 'cn'
import { CheckIcon, EyeOffIcon, XIcon } from 'lucide-react'
import {
  callLabel,
  firstLine,
  int,
  kb,
  NAMES,
  plain,
  sec,
  usd,
  type Lane as LaneState,
  type Step,
} from '@/lib/race'

const ABOUT = {
  browser: 'Drives Chromium. Reads accessibility snapshots, clicks by role and name.',
  afford: 'Reads the page graph. Calls actions by name.',
}

type Props = {
  lane: LaneState
  t: number
  // the meter's full width, the same for both lanes
  scale: number
  // the other lane finished this long ago (it's ahead), or null
  behind: number | null
  started: boolean
}

export const Lane = ({ lane, t, scale, behind, started }: Props) => {
  const { agent, activity } = lane
  const done = activity.kind === 'done' ? activity.done : null
  return (
    <section
      aria-labelledby={`${agent}-name`}
      className={cn(
        'relative flex min-h-0 min-w-0 flex-col gap-4 bg-background p-5 2xl:p-6',
        agent === 'afford' ? '[--lane:var(--afford)]' : '[--lane:var(--browser)]',
      )}
    >
      {/* the finish: the lane rings once in its colour as it resolves */}
      {done && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 animate-finish opacity-0 ring-2 ring-(--lane) ring-inset"
        />
      )}
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 id={`${agent}-name`} className="flex items-center gap-2.5 text-xl font-medium">
            <span aria-hidden className="size-2.5 rounded-full bg-(--lane)" />
            {NAMES[agent]}
          </h2>
          <p className="mt-1 text-[15px] text-pretty text-muted-foreground">
            {ABOUT[agent]}
            <span className="mt-0.5 block font-mono text-[13px]">
              {lane.setup?.tools.map((tool) => tool.name).join(' · ')}
            </span>
          </p>
        </div>
        <Status lane={lane} t={t} started={started} />
      </header>

      <dl className="grid grid-cols-4 gap-x-4 gap-y-3 border-y py-3 sm:grid-cols-[2fr_repeat(4,1fr)]">
        <Stat label={done ? 'Finished' : 'Elapsed'} wide>
          <span className={cn(done && (done.success ? 'text-(--lane)' : 'text-fail'))}>
            {sec(lane.elapsed)}
          </span>
          {behind !== null && (
            <span className="ml-2.5 align-baseline font-mono text-2xl text-fail tabular-nums">
              +{sec(behind)}
            </span>
          )}
        </Stat>
        <Stat label="Turns">{lane.turns}</Stat>
        <Stat label="Tool calls">
          {lane.toolCalls}
          {lane.errors > 0 && (
            <span className="ml-1.5 align-middle font-mono text-base text-fail">
              {lane.errors}✗
            </span>
          )}
        </Stat>
        <Stat label="Tokens">{int(lane.tokens)}</Stat>
        <Stat label="Cost">{lane.costUsd === null ? '—' : usd(lane.costUsd)}</Stat>
      </dl>

      <Meter steps={lane.steps} scale={scale} />

      {/* stacked lanes (narrower than xl) scroll the page, so the panels get a height of their own */}
      <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] max-xl:md:h-[34rem]">
        <div className="flex min-h-0 flex-col gap-4">
          <Viewport lane={lane} />
          <Reads lane={lane} />
        </div>
        <Timeline lane={lane} t={t} />
      </div>
    </section>
  )
}

const Stat = ({
  label,
  wide,
  children,
}: {
  label: string
  wide?: boolean
  children: React.ReactNode
}) => (
  <div className={cn('min-w-0', wide && 'max-sm:col-span-4')}>
    <dt className="text-[13px] text-muted-foreground">{label}</dt>
    <dd
      className={cn(
        'mt-0.5 font-mono font-medium tracking-tight whitespace-nowrap tabular-nums',
        wide ? 'text-4xl 2xl:text-5xl' : 'text-2xl 2xl:text-3xl',
      )}
    >
      {children}
    </dd>
  </div>
)

const Status = ({ lane, t, started }: { lane: LaneState; t: number; started: boolean }) => {
  const { activity } = lane
  if (activity.kind === 'done') {
    const { success } = activity.done
    return (
      <p
        className={cn(
          'flex shrink-0 animate-stamp items-center gap-2 rounded-full px-3.5 py-1.5 text-[15px] font-medium',
          success ? 'bg-(--lane) text-black' : 'bg-fail text-black',
        )}
      >
        {success ? <CheckIcon className="size-4" /> : <XIcon className="size-4" />}
        {success ? 'Done' : 'Failed'}
      </p>
    )
  }
  if (!started) return <p className="shrink-0 text-[15px] text-muted-foreground">Ready</p>
  const label =
    activity.kind === 'tool' ? callLabel(activity.call.name, activity.call.input).verb : 'thinking'
  return (
    <p className="flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-1.5 font-mono text-[15px]">
      <span aria-hidden className="size-2 animate-breathe rounded-full bg-(--lane)" />
      {label}
      <span className="text-muted-foreground tabular-nums">{sec(t - activity.since)}</span>
    </p>
  )
}

// every turn re-reads the whole conversation so far: one segment per turn, the same scale on both lanes
const Meter = ({ steps, scale }: { steps: Step[]; scale: number }) => (
  <div className="flex items-center gap-3">
    <div
      aria-hidden
      className="flex h-3 min-w-0 flex-1 gap-px overflow-hidden rounded-[3px] bg-muted"
    >
      {steps.map((step) => (
        <span
          key={step.turn}
          className="h-full origin-left animate-enter bg-(--lane) first:rounded-l-[3px] even:opacity-75"
          style={{ width: `${(step.tokens / scale) * 100}%` }}
        />
      ))}
    </div>
    <span className="shrink-0 text-[13px] text-muted-foreground">tokens read, turn by turn</span>
  </div>
)

const Viewport = ({ lane }: { lane: LaneState }) => {
  const { frame, agent } = lane
  const url = frame ? new URL(frame.url) : null
  return (
    <figure className="shrink-0 overflow-hidden rounded-lg border bg-card">
      <figcaption className="flex h-8 items-center gap-2 border-b px-3 font-mono text-[13px]">
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
      </figcaption>
      <div className="relative aspect-[16/10] bg-muted/40">
        {frame && (
          // a data url from the recording: there's nothing for next/image to optimize
          // oxlint-disable-next-line nextjs/no-img-element
          <img
            key={frame.id}
            src={frame.image}
            alt={`What a person would see at ${url?.pathname}`}
            className="absolute inset-0 size-full animate-enter object-cover object-top"
          />
        )}
        {agent === 'afford' && (
          <p className="absolute inset-x-2 bottom-2 flex items-center gap-2 rounded-md bg-black/80 px-2.5 py-1.5 text-[13px] text-white backdrop-blur-sm">
            <EyeOffIcon className="size-3.5 shrink-0 text-afford" />
            This agent never sees pixels. Shown for you.
          </p>
        )}
      </div>
    </figure>
  )
}

const Reads = ({ lane }: { lane: LaneState }) => {
  const { read } = lane
  const label = read && callLabel(read.name, read.input)
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border max-md:h-72">
      <div className="flex h-8 shrink-0 items-center gap-3 border-b px-3 text-[13px]">
        <span className="shrink-0 text-muted-foreground">What the model reads</span>
        {read && (
          <>
            <span className="min-w-0 truncate font-mono">
              ← {label!.verb} <span className="text-muted-foreground">{label!.arg}</span>
            </span>
            <span
              className={cn(
                'ml-auto shrink-0 font-mono tabular-nums',
                read.error ? 'text-fail' : 'text-foreground',
              )}
            >
              {read.error ? 'error' : kb(read.result.length)}
            </span>
          </>
        )}
      </div>
      {/* raw, exactly as the model gets it on its next turn */}
      <pre
        key={read?.id}
        aria-label="Latest tool result"
        className={cn(
          'min-h-0 flex-1 animate-enter overflow-auto p-3 font-mono text-xs/[1.55] whitespace-pre-wrap [overflow-wrap:anywhere]',
          read?.error ? 'bg-fail/10 text-fail' : 'text-muted-foreground',
        )}
      >
        {read ? plain(read.result) : ''}
      </pre>
    </div>
  )
}

const Timeline = ({ lane, t }: { lane: LaneState; t: number }) => {
  const { steps, activity } = lane
  // column-reverse pins the scroll to the newest row with no script, and without animating it: rows
  // arrive often
  return (
    <div className="flex min-h-0 flex-col-reverse overflow-y-auto rounded-lg border p-3 max-md:max-h-96">
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
              {step.text && (
                <p className="mt-1 text-[14px]/snug text-pretty text-foreground/90">{step.text}</p>
              )}
              {(step.tools.length > 0 || pending) && (
                <ul className="mt-1.5 flex flex-col gap-1">
                  {step.tools.map((tool) => (
                    <ToolRow
                      key={tool.id}
                      name={tool.name}
                      input={tool.input}
                      ms={tool.ms}
                      error={tool.error}
                    />
                  ))}
                  {pending && (
                    <ToolRow
                      name={pending.call.name}
                      input={pending.call.input}
                      ms={t - pending.since}
                      pending
                    />
                  )}
                </ul>
              )}
            </li>
          )
        })}
        {activity.kind === 'thinking' && t > 0 && (
          <li className="flex items-center gap-2 font-mono text-[14px] text-muted-foreground">
            <span aria-hidden className="size-2 animate-breathe rounded-full bg-(--lane)" />
            thinking
            <span className="ml-auto tabular-nums">{sec(t - activity.since)}</span>
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
  pending,
}: {
  name: string
  input: unknown
  ms: number
  error?: string
  pending?: boolean
}) => {
  const { verb, arg } = callLabel(name, input)
  return (
    <li
      className={cn(
        'animate-enter rounded-md px-2 py-1 font-mono text-[14px]',
        error ? 'bg-fail/12 text-fail' : 'bg-muted/60',
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
        <span className="font-medium">{verb}</span>
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

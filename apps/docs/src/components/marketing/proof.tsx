'use client'

import { useState, useSyncExternalStore } from 'react'
import { LabelList } from 'recharts'
import { cn } from 'cn'
import { EvilBarChart } from '@/components/evilcharts/charts/recharts-bar-chart'
import { ChartTooltip, ChartTooltipContent } from '@/components/evilcharts/ui/recharts-tooltip'
import type { BenchAgent, BenchRun } from '@/lib/bench'
import { headline, int, passed, pct, sec } from '@/lib/bench-format'

export type ProofRun = BenchRun & { name: string }
type Metric = 'tokens' | 'ms'

const config = {
  browser: { label: 'Browser agent', colors: { light: ['var(--fg3)'] } },
  afford: { label: 'Afford agent', colors: { light: ['var(--agent)'] } },
}

export const Dot = ({ agent }: { agent?: boolean }) => (
  <span
    aria-hidden
    className={cn(
      'inline-block size-[7px] flex-none rounded-full',
      agent ? 'bg-(--agent)' : 'bg-(--fg3)',
    )}
  />
)

type Side = 'browser' | 'afford'
type Row = {
  task: string
  fail: { k: Side; text: string }[]
  prompt?: string
  browser: number
  afford: number
  browserLabel: string
  affordLabel: string
  browserRange: string | null
  affordRange: string | null
}

// the task's name, and under it any agent that didn't always finish it, in that agent's colour. recharts
// clones this with the tick's position and index
const AxisTick = ({
  x,
  y,
  payload,
  index = 0,
  rows,
}: {
  x?: number | string
  y?: number | string
  payload?: { value?: unknown }
  index?: number
  rows: Row[]
}) => {
  const fail = rows[index]?.fail ?? []
  return (
    <text x={x} y={y} textAnchor="end" className="fill-(--fg2) text-[13px] max-[599px]:text-xs">
      <tspan x={x} dy={4 - fail.length * 7}>
        {String(payload?.value ?? '')}
      </tspan>
      {fail.map((f) => (
        <tspan
          key={f.k}
          x={x}
          dy={15}
          className={cn(
            'font-mono text-[11px]',
            f.k === 'afford' ? 'fill-(--agent)' : 'fill-(--fg)',
          )}
        >
          {f.text}
        </tspan>
      ))}
    </text>
  )
}

const tooltipLabel = (task: unknown, payload?: readonly { payload?: unknown }[]) => (
  <span className="flex flex-col gap-0.5">
    <span>{String(task)}</span>
    <span className="max-w-60 font-normal text-pretty text-(--fg3)">
      {(payload?.[0]?.payload as Row | undefined)?.prompt}
    </span>
  </span>
)

const tooltipRow = (_v: unknown, name: unknown, item: { payload?: unknown }) => {
  const row = item.payload as Row
  const k = name as Side
  const spread = row[`${k}Range`]
  return (
    <div className="flex w-full flex-col gap-0.5">
      <div className="flex items-center gap-2">
        <Dot agent={k === 'afford'} />
        <span className="text-(--fg3)">{config[k].label}</span>
        <span className="ml-auto font-mono font-medium text-(--fg) tabular-nums">
          {row[`${k}Label`]}
        </span>
      </div>
      {spread && (
        <span className="pl-[15px] font-mono text-(--fg3) tabular-nums">range {spread}</span>
      )}
    </div>
  )
}

const Toggle = <T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) => (
  <fieldset className="flex w-fit max-w-full min-w-0 overflow-x-auto rounded-lg border border-(--line2) p-0.5">
    <legend className="sr-only">{label}</legend>
    {options.map((o) => (
      <button
        key={o.value}
        type="button"
        aria-pressed={o.value === value}
        onClick={() => onChange(o.value)}
        className={cn(
          'press h-7 rounded-md px-2.5 text-[13px] font-medium whitespace-nowrap duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--fg)',
          o.value === value ? 'bg-(--fg) text-(--bg)' : 'text-(--fg2) hover:text-(--fg)',
        )}
      >
        {o.label}
      </button>
    ))}
  </fieldset>
)

// one run per task, browser agent against Afford agent, as tokens or seconds. the marketing proof section and
// the bench page both draw it
export const TaskChart = ({ run, className }: { run: ProofRun; className?: string }) => {
  // the chart mounts in the browser only: it measures its box, and stamps Date.now() as it renders,
  // which a prerender rejects. its box keeps the same height either way, so nothing shifts
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  )
  // a phone gets a narrower axis, so the bars keep most of the width
  const narrow = useSyncExternalStore(
    (on) => {
      const mq = matchMedia('(max-width: 599px)')
      mq.addEventListener('change', on)
      return () => mq.removeEventListener('change', on)
    },
    () => matchMedia('(max-width: 599px)').matches,
    () => false,
  )
  const [metric, setMetric] = useState<Metric>('tokens')

  const value = (x: BenchAgent) => (metric === 'tokens' ? x.tokens : Math.round(x.ms / 100) / 10)
  const label = (x: BenchAgent) => (metric === 'tokens' ? int(x.tokens) : sec(x.ms))
  // a task an agent didn't always finish says so under its name, on the axis, in that agent's colour
  const failNote = (t: (typeof run.tasks)[number]) =>
    (['browser', 'afford'] as const)
      .filter((k) => t[k].successRate < 1)
      .map((k) => ({ k, text: `${run.runs - passed(t[k], run.runs)}/${run.runs} failed` }))
  const fmtRange = (r?: [number, number]) =>
    r && r[0] !== r[1]
      ? metric === 'tokens'
        ? `${int(r[0])}–${int(r[1])}`
        : `${sec(r[0])}–${sec(r[1])}`
      : null
  const data: Row[] = run.tasks.map((t) => ({
    task: t.name,
    fail: failNote(t),
    prompt: t.prompt,
    browser: value(t.browser),
    afford: value(t.afford),
    browserLabel: label(t.browser),
    affordLabel: label(t.afford),
    browserRange: fmtRange(metric === 'tokens' ? t.browser.tokenRange : t.browser.msRange),
    affordRange: fmtRange(metric === 'tokens' ? t.afford.tokenRange : t.afford.msRange),
  }))

  return (
    <figure
      className={cn(
        'rounded-2xl border border-(--line2) p-6 max-[599px]:px-4 max-[599px]:py-5',
        className,
      )}
    >
      <figcaption className="mb-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div>
          <p className="text-[15px] font-medium">Per task</p>
          <p className="mt-0.5 text-[13px] text-(--fg3)">
            {metric === 'tokens' ? 'Tokens' : 'Seconds'}, median of {run.runs}{' '}
            {run.runs === 1 ? 'run' : 'runs'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <div className="flex items-center gap-4 text-[13px] text-(--fg2)">
            <span className="flex items-center gap-1.5">
              <Dot />
              Browser agent
            </span>
            <span className="flex items-center gap-1.5">
              <Dot agent />
              Afford agent
            </span>
          </div>
          <Toggle
            label="Metric"
            value={metric}
            options={[
              { value: 'tokens', label: 'Tokens' },
              { value: 'ms', label: 'Time' },
            ]}
            onChange={setMetric}
          />
        </div>
      </figcaption>
      <div className="h-[340px] max-[599px]:h-[380px]">
        {mounted && (
          <EvilBarChart
            config={config}
            data={data}
            layout="horizontal"
            animationType="none"
            barRadius={3}
            barGap={3}
            barCategoryGap={14}
            className="aspect-auto h-full"
            chartProps={{ margin: { top: 0, bottom: 0, left: 0, right: narrow ? 60 : 64 } }}
          >
            <EvilBarChart.XAxis hide domain={[0, 'dataMax']} />
            <EvilBarChart.YAxis
              dataKey="task"
              width={narrow ? 108 : 128}
              tick={<AxisTick rows={data} />}
            />
            {(['browser', 'afford'] as const).map((k) => (
              <EvilBarChart.Bar
                key={k}
                dataKey={k}
                enableHoverHighlight
                barProps={{
                  children: (
                    <LabelList
                      dataKey={`${k}Label`}
                      position="right"
                      offset={8}
                      className={cn(
                        'font-mono text-xs tabular-nums',
                        k === 'afford' ? 'fill-(--agent)' : 'fill-(--fg2)',
                      )}
                    />
                  ),
                }}
              />
            ))}
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  className="min-w-52"
                  labelFormatter={tooltipLabel}
                  formatter={tooltipRow}
                />
              }
            />
          </EvilBarChart>
        )}
      </div>
      {/* sr-only on the wrapper: a table never shrinks below its content, so it would widen the page */}
      <div className="sr-only">
        <table>
          <caption>
            Per task medians on {run.name}, {run.runs} runs each
          </caption>
          <thead>
            <tr>
              <th scope="col">Task</th>
              <th scope="col">Browser agent tokens</th>
              <th scope="col">Afford agent tokens</th>
              <th scope="col">Browser agent time</th>
              <th scope="col">Afford agent time</th>
              <th scope="col">Browser agent passed</th>
              <th scope="col">Afford agent passed</th>
            </tr>
          </thead>
          <tbody>
            {run.tasks.map((t) => (
              <tr key={t.id}>
                <th scope="row">{t.name}</th>
                <td>{int(t.browser.tokens)}</td>
                <td>{int(t.afford.tokens)}</td>
                <td>{sec(t.browser.ms)}</td>
                <td>{sec(t.afford.ms)}</td>
                <td>
                  {passed(t.browser, run.runs)} of {run.runs}
                </td>
                <td>
                  {passed(t.afford, run.runs)} of {run.runs}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  )
}

// the bench, as numbers first and then per task: browser agent against Afford agent on one model, with a
// toggle when more than one model has a committed run. every figure is computed from the results files
export const Proof = ({ runs }: { runs: ProofRun[] }) => {
  const [m, setM] = useState(0)
  const run = runs[m]!
  const b = run.browser
  const stats = headline(run)

  // where an agent didn't finish, in words: the one thing a median hides
  const misses = (side: 'browser' | 'afford') =>
    run.tasks
      .filter((t) => t[side].successRate < 1)
      .map(
        (t) =>
          `${t.name.toLowerCase()} in ${run.runs - passed(t[side], run.runs)} of ${run.runs} runs`,
      )
  const bMiss = misses('browser')
  const aMiss = misses('afford')
  const other = runs.findIndex((r) => r.browser.successRate < r.afford.successRate)

  return (
    <div className="flex flex-col gap-10">
      {runs.length > 1 && (
        <Toggle
          label="Model"
          value={m}
          options={runs.map((r, i) => ({ value: i, label: r.name }))}
          onChange={setM}
        />
      )}

      <dl className="grid grid-cols-4 border-t border-(--line) max-[899px]:grid-cols-2">
        {stats.map((s) => (
          <div
            key={s.label}
            className="flex flex-col gap-1.5 border-b border-(--line) py-6 pr-6 max-[899px]:py-5"
          >
            <dt className="order-2 text-[15px] text-(--fg)">{s.label}</dt>
            <dd className="order-1 text-[44px] leading-none font-semibold tracking-[-0.045em] tabular-nums max-[599px]:text-[34px]">
              {s.big}
            </dd>
            <dd className="order-3 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-(--fg3) tabular-nums">
              <span className="flex items-center gap-1.5">
                <Dot agent />
                <span className="sr-only">Afford agent </span>
                {s.a}
              </span>
              <span className="flex items-center gap-1.5">
                <Dot />
                <span className="sr-only">browser agent </span>
                {s.b}
              </span>
            </dd>
          </div>
        ))}
      </dl>

      {(bMiss.length > 0 || aMiss.length > 0) && (
        <p className="-mt-4 max-w-[680px] border-l-2 border-(--agent) pl-4 text-[15px] leading-relaxed text-pretty text-(--fg2)">
          <span className="font-medium text-(--fg)">
            On {run.name}, the browser agent completed {pct(b.successRate)} of tasks.
          </span>{' '}
          {bMiss.length > 0 && <>It failed {bMiss.join(' and ')}. </>}
          {aMiss.length
            ? `The Afford agent failed ${aMiss.join(' and ')}.`
            : 'The Afford agent completed every task.'}
        </p>
      )}
      {!bMiss.length && !aMiss.length && other >= 0 && other !== m && (
        <p className="-mt-4 text-[15px] text-(--fg2)">
          Both agents completed every task here. On a smaller model, they don’t.{' '}
          <button
            type="button"
            onClick={() => setM(other)}
            className="font-medium text-(--fg) underline decoration-(--line2) underline-offset-4 transition-colors duration-150 hover:decoration-(--fg)"
          >
            See {runs[other]!.name}
          </button>
        </p>
      )}

      <TaskChart run={run} />

      <p className="-mt-4 flex flex-wrap gap-x-3 font-mono text-xs whitespace-nowrap text-(--fg3)">
        <span>{run.name}</span>
        <span>{run.runs} runs per task</span>
        {run.finishedAt && <span>{run.finishedAt.slice(0, 10)}</span>}
        {run.commit && <span>commit {run.commit}</span>}
      </p>
    </div>
  )
}

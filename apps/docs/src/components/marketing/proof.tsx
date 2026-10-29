'use client'

import { useState, useSyncExternalStore } from 'react'
import { LabelList } from 'recharts'
import { cn } from 'cn'
import { EvilBarChart } from '@/components/evilcharts/charts/recharts-bar-chart'
import { ChartTooltip, ChartTooltipContent } from '@/components/evilcharts/ui/recharts-tooltip'
import type { AgentKey, BenchAgent, BenchRun } from '@/lib/bench'
import { agentName, agentsOf, headline, int, passed, pct, sec } from '@/lib/bench-format'

export type ProofRun = BenchRun & { name: string }
type Metric = 'tokens' | 'ms'

// the browser agent is grey, the screenshot agent a lighter grey, and the Affordances agent the accent
const config = {
  browser: { label: 'Browser agent', colors: { light: ['var(--fg3)'] } },
  vision: { label: 'Screenshot agent', colors: { light: ['var(--shot)'] } },
  afford: { label: 'Affordances agent', colors: { light: ['var(--agent)'] } },
}
const capital = (k: AgentKey) => config[k].label

export const Dot = ({ k = 'browser' }: { k?: AgentKey }) => (
  <span
    aria-hidden
    className={cn(
      'inline-block size-[7px] flex-none rounded-full',
      k === 'afford' ? 'bg-(--agent)' : k === 'vision' ? 'bg-(--shot)' : 'bg-(--fg3)',
    )}
  />
)

// one task: per agent, its value, label and range under `${agent}`, `${agent}Label`, `${agent}Range`
type Row = {
  task: string
  fail: { k: AgentKey; text: string }[]
  prompt?: string
} & Record<string, unknown>

// the task's name, and under it any agent that didn't always finish it, behind that agent's dot. recharts
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
      {fail.flatMap((f) => [
        <tspan
          key={f.k}
          x={x}
          dy={15}
          className={cn(
            'text-[10px]',
            f.k === 'afford'
              ? 'fill-(--agent)'
              : f.k === 'vision'
                ? 'fill-(--shot)'
                : 'fill-(--fg3)',
          )}
        >
          ●
        </tspan>,
        <tspan key={`${f.k}-t`} dx={4} className="fill-(--fg) font-mono text-[11px]">
          {f.text}
        </tspan>,
      ])}
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
  const k = name as AgentKey
  const spread = row[`${k}Range`] as string | null
  return (
    <div className="flex w-full flex-col gap-0.5">
      <div className="flex items-center gap-2">
        <Dot k={k} />
        <span className="text-(--fg3)">{config[k].label}</span>
        <span className="ml-auto font-mono font-medium text-(--fg) tabular-nums">
          {row[`${k}Label`] as string}
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

// one run per task, every agent the run had, as tokens or seconds. bars are linear: the long tasks' gap is the
// finding, and each bar carries its value. the marketing proof section and the bench page both draw it
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
  const ks = agentsOf(run)

  const value = (x: BenchAgent) => (metric === 'tokens' ? x.tokens : Math.round(x.ms / 100) / 10)
  const label = (x: BenchAgent) => (metric === 'tokens' ? int(x.tokens) : sec(x.ms))
  // a task an agent didn't always finish says so under its name, on the axis, in that agent's colour
  const failNote = (t: (typeof run.tasks)[number]) =>
    ks.flatMap((k) => {
      const x = t[k]
      return x && x.successRate < 1
        ? [
            {
              k,
              text: `${run.runs - passed(x, run.runs)}/${run.runs} failed`,
            },
          ]
        : []
    })
  const fmtRange = (r?: [number, number]) =>
    r && r[0] !== r[1]
      ? metric === 'tokens'
        ? `${int(r[0])}–${int(r[1])}`
        : `${sec(r[0])}–${sec(r[1])}`
      : null
  const data: Row[] = run.tasks.map((t) => {
    const row: Row = { task: t.name, fail: failNote(t), prompt: t.prompt }
    for (const k of ks) {
      const x = t[k]
      if (!x) continue
      row[k] = value(x)
      row[`${k}Label`] = label(x)
      row[`${k}Range`] = fmtRange(metric === 'tokens' ? x.tokenRange : x.msRange)
    }
    return row
  })

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
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-(--fg2)">
            {ks.map((k) => (
              <span key={k} className="flex items-center gap-1.5">
                <Dot k={k} />
                {capital(k)}
              </span>
            ))}
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
      {/* tall enough for every bar, from the server on, so nothing shifts when the chart mounts */}
      <div style={{ height: run.tasks.length * (ks.length * 18 + 26) + 20 }}>
        {mounted && (
          <EvilBarChart
            config={config}
            data={data}
            layout="horizontal"
            animationType="none"
            barRadius={3}
            barGap={2}
            barCategoryGap={ks.length > 2 ? 12 : 14}
            className="aspect-auto h-full"
            chartProps={{ margin: { top: 0, bottom: 0, left: 0, right: narrow ? 60 : 64 } }}
          >
            <EvilBarChart.XAxis hide domain={[0, 'dataMax']} />
            <EvilBarChart.YAxis
              dataKey="task"
              width={narrow ? 128 : 136}
              tick={<AxisTick rows={data} />}
            />
            {ks.map((k) => (
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
              {(['tokens', 'time', 'passed'] as const).flatMap((m) =>
                ks.map((k) => (
                  <th key={m + k} scope="col">
                    {capital(k)} {m}
                  </th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            {run.tasks.map((t) => (
              <tr key={t.id}>
                <th scope="row">{t.name}</th>
                {ks.map((k) => (
                  <td key={k}>{t[k] ? int(t[k].tokens) : '–'}</td>
                ))}
                {ks.map((k) => (
                  <td key={k}>{t[k] ? sec(t[k].ms) : '–'}</td>
                ))}
                {ks.map((k) => (
                  <td key={k}>{t[k] ? `${passed(t[k], run.runs)} of ${run.runs}` : '–'}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  )
}

// the bench, as numbers first and then per task: every agent on one model, with a toggle when more than one
// model has a committed run. every figure is computed from the results files
export const Proof = ({ runs }: { runs: ProofRun[] }) => {
  const [m, setM] = useState(0)
  const run = runs[m]!
  const ks = agentsOf(run)
  const stats = headline(run)

  // where an agent didn't finish, in words: the one thing a median hides
  const misses = (k: AgentKey) =>
    run.tasks.flatMap((t) => {
      const x = t[k]
      return x && x.successRate < 1
        ? [`${t.name.toLowerCase()} in ${run.runs - passed(x, run.runs)} of ${run.runs} runs`]
        : []
    })
  const missed = ks.filter((k) => misses(k).length)
  const clean = ks.filter((k) => !misses(k).length)
  const other = runs.findIndex((r) =>
    agentsOf(r).some((k) => r.tasks.some((t) => (t[k]?.successRate ?? 1) < 1)),
  )

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
            className="flex flex-col gap-1.5 border-b border-(--line) py-6 pr-6 max-[899px]:py-5 max-[599px]:pr-4"
          >
            <dt className="order-2 text-[15px] text-(--fg)">
              {s.label}
              {s.against && <span className="text-(--fg2)"> {s.against}</span>}
            </dt>
            <dd className="order-1 text-[44px] leading-none font-semibold tracking-[-0.045em] tabular-nums max-[599px]:text-[34px]">
              {s.big}
            </dd>
            {s.also && (
              <dd className="order-3 text-[13px] leading-snug text-pretty text-(--fg3)">
                {s.also}
              </dd>
            )}
            <dd className="order-4 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-(--fg3) tabular-nums">
              {(['afford', ...ks.filter((k) => k !== 'afford')] as AgentKey[]).map(
                (k) =>
                  s.values[k] && (
                    <span key={k} className="flex items-center gap-1.5">
                      <Dot k={k} />
                      <span className="sr-only">{capital(k)} </span>
                      {s.values[k]}
                    </span>
                  ),
              )}
            </dd>
          </div>
        ))}
      </dl>

      {missed.length > 0 && (
        <p className="-mt-4 max-w-[680px] border-l-2 border-(--agent) pl-4 text-[15px] leading-relaxed text-pretty text-(--fg2)">
          {missed.map((k, i) => (
            <span key={k}>
              <span className="font-medium text-(--fg)">
                {i === 0 && `On ${run.name}, the `}
                {i > 0 && 'The '}
                {agentName[k]} completed {pct(run[k]!.successRate)} of tasks.
              </span>{' '}
              It failed {misses(k).join(' and ')}.{' '}
            </span>
          ))}
          {clean.length > 0 &&
            `The ${clean.map((k) => agentName[k]).join(' and the ')} completed every task.`}
        </p>
      )}
      {!missed.length && other >= 0 && other !== m && (
        <p className="-mt-4 text-[15px] text-(--fg2)">
          Every agent completed every task here. On a smaller model, not all of them do.{' '}
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

import { Fragment } from 'react'
import { cn } from 'cn'
import { AgentSkip, AgentText } from '@affordances/md/react'
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@affordances/ui/components/table'
import { Heading } from '@/components/heading'
import { TypeTable } from '@/components/type-table'
import { Dot, TaskChart } from '@/components/marketing/proof'
import {
  benchHistory,
  benchRuns,
  modelName,
  taskName,
  type AgentKey,
  type BenchAgent,
  type BenchRun,
  type TokenSplit,
} from '@/lib/bench'
import { agentName, agentsOf, headline, int, passed, pct, sec, usd } from '@/lib/bench-format'

// the docs' table cells (see mdx-components), with numbers right-aligned on tabular figures
const th = 'px-3 text-xs font-medium'
const td = 'px-3 py-2.5 text-[0.8125rem]'
const num = 'text-right tabular-nums'
const short: Record<AgentKey, string> = {
  browser: 'Browser',
  vision: 'Screenshot',
  afford: 'Affordances',
}

const Agent = ({ k }: { k: AgentKey }) => (
  <span className="flex items-center gap-2">
    <Dot k={k} />
    {short[k]}
  </span>
)

// the headline figures in sentences, for the markdown twin
const summaryMd = (r: BenchRun) => {
  const ks = agentsOf(r)
  const each = (f: (x: BenchAgent) => string) =>
    ks.map((k) => `${f(r[k]!)} for the ${agentName[k]}`).join(', ')
  const cost = ks.every((k) => r[k]!.costPerSuccessUsd !== undefined)
    ? ` Cost per successful task: ${each((x) => usd(x.costPerSuccessUsd!))}.`
    : ''
  const ratios = headline(r)
    .filter((s) => s.against)
    .map((s) => `${s.big} ${s.label} ${s.against}${s.also ? ` (${s.also})` : ''}`)
    .join('; ')
  return `Median per run: ${each((x) => `${int(x.tokens)} tokens`)}; ${each((x) => sec(x.ms))}; ${each((x) => `${x.turns} turns`)}.${cost} Tasks completed: ${each((x) => pct(x.successRate))}. Against the stronger baseline on each measure: ${ratios}.`
}

const Headline = ({ run }: { run: BenchRun }) => {
  const order = ['afford', ...agentsOf(run).filter((k) => k !== 'afford')] as AgentKey[]
  return (
    <AgentText block md={summaryMd(run)}>
      <dl className="not-typeset grid grid-cols-4 border-t max-sm:grid-cols-2">
        {headline(run).map((s) => (
          <div key={s.label} className="flex flex-col gap-1 border-b py-4 pr-4">
            <dt className="order-2 text-[0.8125rem] leading-snug text-pretty">
              {s.label}
              {s.against && <span className="text-muted-foreground"> {s.against}</span>}
            </dt>
            <dd className="order-1 text-2xl leading-none font-semibold tracking-tight tabular-nums">
              {s.big}
            </dd>
            {s.also && (
              <dd className="order-3 text-xs leading-snug text-pretty text-muted-foreground">
                {s.also}
              </dd>
            )}
            <dd className="order-4 mt-1 flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs text-muted-foreground tabular-nums">
              {order.map(
                (k) =>
                  s.values[k] && (
                    <span key={k} className="flex items-center gap-1.5">
                      <Dot k={k} />
                      <span className="sr-only">{agentName[k]} </span>
                      {s.values[k]}
                    </span>
                  ),
              )}
            </dd>
          </div>
        ))}
      </dl>
    </AgentText>
  )
}

// a task's rows sit close, so the group reads as one
const pad = (i: number, n: number) =>
  i === 0 ? 'pt-2.5 pb-1' : i === n - 1 ? 'pt-1 pb-2.5' : 'py-1'

// one row group per task: the task names the group, each agent heads its own row
const TaskTable = ({ run, name }: { run: BenchRun; name: string }) => {
  const ks = agentsOf(run)
  const cost = run.tasks.some((t) => t.browser.costPerSuccessUsd ?? t.afford.costPerSuccessUsd)
  const cells = (x: BenchAgent) => {
    const ok = passed(x, run.runs)
    return [
      { key: 'turns', v: `${x.turns}` },
      { key: 'tokens', v: int(x.tokens) },
      { key: 'time', v: sec(x.ms) },
      ...(cost
        ? [{ key: 'cost', v: x.costPerSuccessUsd === undefined ? '–' : usd(x.costPerSuccessUsd) }]
        : []),
      {
        key: 'passed',
        v: `${ok}/${run.runs}`,
        // a miss is the one thing a median hides, so it's the one cell that stands out
        className: ok < run.runs ? 'font-medium text-foreground' : 'text-muted-foreground',
      },
    ]
  }
  // with three agents, tighter gutters keep every column in the article's width
  return (
    <TypeTable className="[&_td]:px-2 [&_th]:px-2">
      <caption className="sr-only">
        Per task on {name}: medians of {run.runs} runs
        {cost ? ', cost per successful run' : ''}
      </caption>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead scope="col" className={th}>
            Task
          </TableHead>
          <TableHead scope="col" className={th}>
            Agent
          </TableHead>
          {['Turns', 'Tokens', 'Time', ...(cost ? ['Cost'] : []), 'Passed'].map((h) => (
            <TableHead key={h} scope="col" className={cn(th, 'text-right')}>
              {h}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      {run.tasks.map((t) => (
        <tbody key={t.id} className="border-b last:border-0">
          {ks.map((k, i) => (
            <TableRow key={k} className="border-0 hover:bg-transparent">
              {i === 0 && (
                <TableHead
                  scope="rowgroup"
                  rowSpan={ks.length}
                  className={cn(th, 'h-auto pt-2.5 align-top text-[0.8125rem]')}
                >
                  {t.name}
                </TableHead>
              )}
              <TableHead
                scope="row"
                className={cn(th, pad(i, ks.length), 'h-auto text-[0.8125rem] font-normal')}
              >
                <Agent k={k} />
              </TableHead>
              {cells(t[k]!).map((c) => (
                <TableCell key={c.key} className={cn(td, pad(i, ks.length), num, c.className)}>
                  {c.v}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </tbody>
      ))}
    </TypeTable>
  )
}

const SPLIT: [keyof TokenSplit, string][] = [
  ['input', 'Input'],
  ['cacheRead', 'Cache read'],
  ['cacheWrite', 'Cache write'],
  ['output', 'Output'],
]

const SplitTable = ({ run, name }: { run: BenchRun; name: string }) => (
  <TypeTable>
    <caption className="sr-only">Tokens by kind on {name}, median per run</caption>
    <TableHeader>
      <TableRow className="hover:bg-transparent">
        <TableHead scope="col" className={th}>
          Agent
        </TableHead>
        {SPLIT.map(([k, h]) => (
          <TableHead key={k} scope="col" className={cn(th, 'text-right')}>
            {h}
          </TableHead>
        ))}
      </TableRow>
    </TableHeader>
    <TableBody>
      {agentsOf(run).map((k) => (
        <TableRow key={k} className="hover:bg-transparent">
          <TableHead scope="row" className={cn(th, 'text-[0.8125rem] font-normal')}>
            <Agent k={k} />
          </TableHead>
          {SPLIT.map(([s]) => (
            <TableCell key={s} className={cn(td, num)}>
              {int(run[k]!.tokenSplit![s])}
            </TableCell>
          ))}
        </TableRow>
      ))}
    </TableBody>
  </TypeTable>
)

const day = (iso: string) => iso.slice(0, 10)

// the newest full run of each model: headline figures, the per-task chart, and the per-task table behind it
export const BenchResults = () => {
  const runs = benchRuns()
  if (!runs.length) return <p>Results will appear here after the first bench run is committed.</p>
  return (
    <div className="bench">
      {runs.map((run) => {
        const name = modelName(run.model)
        return (
          <section key={run.file} aria-labelledby={run.model}>
            <Heading as="h3" id={run.model}>
              {name}
            </Heading>
            <p className="text-[0.8125rem] text-pretty text-muted-foreground">
              Medians of {run.runs} {run.runs === 1 ? 'run' : 'runs'} per task
              {run.finishedAt && <>, run on {day(run.finishedAt)}</>}
              {run.commit && (
                <>
                  {' '}
                  at commit <code>{run.commit}</code>
                  {run.dirty && ' (uncommitted changes)'}
                </>
              )}
              . Cost is per successful run.
            </p>
            <Headline run={run} />
            <AgentSkip>
              <TaskChart
                run={{ ...run, name }}
                className="not-typeset rounded-(--radius) p-5 max-[599px]:p-4"
              />
            </AgentSkip>
            <TaskTable run={run} name={name} />
            {agentsOf(run).every((k) => run[k]!.tokenSplit) && (
              <>
                <p>
                  Where the tokens go, median per run. Every turn re-reads the conversation so far
                  from the cache, so cache reads grow with each step an agent takes.
                </p>
                <SplitTable run={run} name={name} />
              </>
            )}
          </section>
        )
      })}
    </div>
  )
}

// what changed at each divider in the history, newest first
const ERA_NOTE = [
  '',
  'Earlier runs used the simpler store and five tasks, without the screenshot agent',
  'Earlier runs measured the browser agent before its fixes',
]

// every committed results file, newest first. a dash in an agent's column means the run didn't have it
export const BenchHistory = () => {
  const files = benchHistory()
  if (!files.length) return null
  // seven columns, tighter gutters, runs folded into tasks and the year left off the time, so it fits the
  // article column without scrolling (every run so far is from 2026; the file link carries the full date)
  return (
    <TypeTable className="[&_td]:px-2 [&_th]:px-2">
      <caption className="sr-only">
        Every committed bench run, newest first, with median tokens per run
      </caption>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {[
            'Finished',
            'Model',
            'Tasks × runs',
            'Commit',
            'Browser',
            'Screenshot',
            'Affordances',
          ].map((h, i) => (
            <TableHead key={h} scope="col" className={cn(th, i > 3 && 'text-right')}>
              {h}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {files.map((f, i) => (
          <Fragment key={f.file}>
            {/* a divider above the first run of each earlier method */}
            {f.era > 0 && f.era !== (files[i - 1]?.era ?? 0) && (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={7}
                  className={cn(td, 'whitespace-normal text-muted-foreground')}
                >
                  {ERA_NOTE[f.era]}; see <a href="#changes-to-the-method">changes to the method</a>.
                </TableCell>
              </TableRow>
            )}
            <TableRow className="hover:bg-transparent">
              <TableHead
                scope="row"
                className={cn(th, 'text-[0.8125rem] font-normal tabular-nums')}
              >
                <a
                  href={`https://github.com/vltpkg/affordances/blob/main/apps/bench/results/${f.file}`}
                >
                  {f.finishedAt
                    ? `${f.finishedAt.slice(5, 10)} ${f.finishedAt.slice(11, 16)}`
                    : f.file.slice(5, 10)}
                </a>
              </TableHead>
              {/* the column is narrow, and every model here is a Claude */}
              <TableCell className={td}>
                {f.model ? modelName(f.model).replace(/^Claude /, '') : '–'}
              </TableCell>
              <TableCell className={cn(td, 'tabular-nums')}>
                {f.partial ? f.tasks.map(taskName).join(', ') : `All ${f.tasks.length}`} ×{' '}
                {f.runs ?? '–'}
                {f.partial && <span className="block text-muted-foreground">partial</span>}
              </TableCell>
              <TableCell className={cn(td, 'font-mono')}>
                {f.commit ?? <span className="text-muted-foreground">–</span>}
                {f.dirty && <span className="text-muted-foreground"> dirty</span>}
              </TableCell>
              <TableCell className={cn(td, num)}>
                {f.browser ? int(f.browser.medianTokens) : '–'}
              </TableCell>
              <TableCell className={cn(td, num)}>
                {f.vision ? int(f.vision.medianTokens) : '–'}
              </TableCell>
              <TableCell className={cn(td, num)}>
                {f.afford ? int(f.afford.medianTokens) : '–'}
              </TableCell>
            </TableRow>
          </Fragment>
        ))}
      </TableBody>
    </TypeTable>
  )
}

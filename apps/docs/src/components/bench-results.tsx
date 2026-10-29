import { cn } from 'cn'
import { AgentSkip, AgentText } from '@afford/md/react'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@afford/ui/components/table'
import { Heading } from '@/components/heading'
import { TypeTable } from '@/components/type-table'
import { Dot, TaskChart } from '@/components/marketing/proof'
import {
  benchHistory,
  benchRuns,
  modelName,
  taskName,
  type BenchAgent,
  type BenchRun,
  type TokenSplit,
} from '@/lib/bench'
import { headline, int, passed, pct, sec, usd } from '@/lib/bench-format'

// the docs' table cells (see mdx-components), with numbers right-aligned on tabular figures
const th = 'px-3 text-xs font-medium'
const td = 'px-3 py-2.5 text-[0.8125rem]'
const num = 'text-right tabular-nums'
const AGENTS = ['browser', 'afford'] as const

const Agent = ({ k }: { k: (typeof AGENTS)[number] }) => (
  <span className="flex items-center gap-2">
    <Dot agent={k === 'afford'} />
    {k === 'afford' ? 'Afford' : 'Browser'}
  </span>
)

// the headline figures in one sentence, for the markdown twin
const summaryMd = (r: BenchRun) => {
  const { browser: b, afford: a } = r
  const cost =
    a.costPerSuccessUsd !== undefined && b.costPerSuccessUsd !== undefined
      ? `, ${usd(b.costPerSuccessUsd)} against ${usd(a.costPerSuccessUsd)} per successful task`
      : ''
  return `Median per run, browser agent against Afford agent: ${int(b.tokens)} against ${int(a.tokens)} tokens, ${sec(b.ms)} against ${sec(a.ms)}, ${b.turns} against ${a.turns} turns${cost}. Tasks completed: ${pct(b.successRate)} against ${pct(a.successRate)}.`
}

const Headline = ({ run }: { run: BenchRun }) => (
  <AgentText block md={summaryMd(run)}>
    <dl className="not-typeset grid grid-cols-4 border-t max-sm:grid-cols-2">
      {headline(run).map((s) => (
        <div key={s.label} className="flex flex-col gap-1 border-b py-4 pr-4">
          <dt className="order-2 text-[0.8125rem] leading-snug text-pretty">{s.label}</dt>
          <dd className="order-1 text-2xl leading-none font-semibold tracking-tight tabular-nums">
            {s.big}
          </dd>
          <dd className="order-3 mt-1 flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs text-muted-foreground tabular-nums">
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
  </AgentText>
)

// a task's two rows sit close, so the pair reads as one group
const pair = { browser: 'pt-2.5 pb-1', afford: 'pt-1 pb-2.5' }

// one row group per task: the task names the group, each agent heads its own row
const TaskTable = ({ run, name }: { run: BenchRun; name: string }) => {
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
  return (
    <TypeTable>
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
          {AGENTS.map((k) => (
            <TableRow key={k} className="border-0 hover:bg-transparent">
              {k === 'browser' && (
                <TableHead
                  scope="rowgroup"
                  rowSpan={2}
                  className={cn(th, 'h-auto pt-2.5 align-top text-[0.8125rem]')}
                >
                  {t.name}
                </TableHead>
              )}
              <TableHead
                scope="row"
                className={cn(th, pair[k], 'h-auto text-[0.8125rem] font-normal')}
              >
                <Agent k={k} />
              </TableHead>
              {cells(t[k]).map((c) => (
                <TableCell key={c.key} className={cn(td, pair[k], num, c.className)}>
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
      {AGENTS.map((k) => (
        <TableRow key={k} className="hover:bg-transparent">
          <TableHead scope="row" className={cn(th, 'text-[0.8125rem] font-normal')}>
            <Agent k={k} />
          </TableHead>
          {SPLIT.map(([s]) => (
            <TableCell key={s} className={cn(td, num)}>
              {int(run[k].tokenSplit![s])}
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
            {run.browser.tokenSplit && run.afford.tokenSplit && (
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

// every committed results file, newest first
export const BenchHistory = () => {
  const files = benchHistory()
  if (!files.length) return null
  // seven columns: tighter gutters, so it fits the article column without scrolling
  return (
    <TypeTable className="[&_td]:px-2 [&_th]:px-2 [&_tr>*:first-child]:pl-3 [&_tr>*:last-child]:pr-3">
      <caption className="sr-only">
        Every committed bench run, newest first, with median tokens per run
      </caption>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {['Finished', 'Model', 'Tasks', 'Runs', 'Commit', 'Browser', 'Afford'].map((h, i) => (
            <TableHead key={h} scope="col" className={cn(th, i > 2 && i !== 4 && 'text-right')}>
              {h}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {files.map((f) => (
          <TableRow key={f.file} className="hover:bg-transparent">
            <TableHead scope="row" className={cn(th, 'text-[0.8125rem] font-normal tabular-nums')}>
              <a href={`https://github.com/afford/afford/blob/main/apps/bench/results/${f.file}`}>
                {f.finishedAt
                  ? `${day(f.finishedAt)} ${f.finishedAt.slice(11, 16)}`
                  : f.file.slice(0, 10)}
              </a>
            </TableHead>
            {/* the column is narrow, and every model here is a Claude */}
            <TableCell className={td}>
              {f.model ? modelName(f.model).replace(/^Claude /, '') : '–'}
            </TableCell>
            <TableCell className={td}>
              {f.partial ? (
                <>
                  {f.tasks.map(taskName).join(', ')}{' '}
                  <span className="text-muted-foreground">(partial)</span>
                </>
              ) : (
                `All ${f.tasks.length}`
              )}
            </TableCell>
            <TableCell className={cn(td, num)}>{f.runs ?? '–'}</TableCell>
            <TableCell className={cn(td, 'font-mono')}>
              {f.commit ?? <span className="text-muted-foreground">–</span>}
              {f.dirty && <span className="text-muted-foreground"> dirty</span>}
            </TableCell>
            <TableCell className={cn(td, num)}>
              {f.browser ? int(f.browser.medianTokens) : '–'}
            </TableCell>
            <TableCell className={cn(td, num)}>
              {f.afford ? int(f.afford.medianTokens) : '–'}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </TypeTable>
  )
}

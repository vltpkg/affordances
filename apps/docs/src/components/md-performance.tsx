import { cn } from 'cn'
import { AgentSkip } from '@affordances/md/react'
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@affordances/ui/components/table'
import { TypeTable } from '@/components/type-table'
import data from '@/data/md-performance.json'

// one recorded run of packages/md-core's bench/run.ts --json (here, not beside the page: fumadocs reads every json
// under content/ as a meta file), with the commit, the load and the tools' versions
type Cell = {
  median: number
  p25: number
  p75: number
  runs: number
  outBytes?: number
  error?: string
}
type Tool = {
  name: string
  status: string
  pages: Record<string, Cell>
  total?: number
  mbps?: number
  outBytes?: number
}
type Run = {
  date: string
  node: string
  cpu: string
  runs: number
  warmup: number
  gc: boolean
  commit: string
  load: number
  versions: Record<string, string>
  pages: { name: string; bytes: number }[]
  tools: Tool[]
}
const run = data as Run
const published = run.versions.published!

// the rows the page shows, in order, by the bench's tool names: ours first, then the others
const ROWS = [
  {
    name: '@affordances/md',
    label: '@affordances/md',
    short: 'md',
    version: run.commit.slice(0, 8),
  },
  {
    name: 'md-core',
    label: 'its converter alone (md-core)',
    short: 'converter',
    version: run.commit.slice(0, 8),
  },
  {
    name: `@affordances/md@${published}`,
    label: '@affordances/md, last published',
    short: published,
    version: published,
  },
  { name: 'mdream', label: 'mdream', short: 'mdream', version: run.versions.mdream! },
  {
    name: 'turndown+gfm',
    label: 'turndown + turndown-plugin-gfm',
    short: 'turndown',
    version: `${run.versions.turndown} + ${run.versions['turndown-plugin-gfm']}`,
  },
  {
    name: 'node-html-markdown',
    label: 'node-html-markdown',
    short: 'nhm',
    version: run.versions['node-html-markdown']!,
  },
]
const tool = (name: string) => {
  const found = run.tools.find((t) => t.name === name)
  if (!found || found.status !== 'ok' || found.total === undefined)
    throw new Error(`performance.json has no complete run of ${name}`)
  return found as Tool & { total: number; mbps: number; outBytes: number }
}
const rows = ROWS.map((row) => ({ ...row, tool: tool(row.name) }))
const md = tool('@affordances/md')
const before = tool(`@affordances/md@${published}`)
const mdream = tool('mdream')
const turndown = tool('turndown+gfm')
const nhm = tool('node-html-markdown')

// as bench/table.ts writes them: ms to 2 places under 1, 1 under 100; KB of 1024 bytes
const ms = (n: number) => (n < 1 ? n.toFixed(2) : n < 100 ? n.toFixed(1) : n.toFixed(0))
const time = (n: number) => (n < 1000 ? `${ms(n)} ms` : `${(n / 1000).toFixed(2)} s`)
const kb = (bytes: number) => `${(bytes / 1024).toFixed(0)} KB`
const rate = (n: number) => n.toFixed(n < 10 ? 2 : 1)
const mbps = (n: number) => `${rate(n)} MB/s`
const times = (a: number, b: number) => `${(a / b).toFixed(1)}×`
// the fewest and most timed runs a tool got on a page
const runsOf = (t: Tool) => {
  const counts = Object.values(t.pages).map((cell) => cell.runs)
  const [low, high] = [Math.min(...counts), Math.max(...counts)]
  return low === high ? `${low}` : `${low}–${high}`
}
const corpus = run.pages.reduce((sum, page) => sum + page.bytes, 0)

const th = 'px-3 text-xs font-medium'
const td = 'px-3 py-2.5 text-[0.8125rem]'
const num = 'text-right tabular-nums'

// the headline in a sentence, every figure from the run
export const PerfSummary = () => {
  const core = tool('md-core')
  return (
    <p>
      On this corpus ({run.pages.length} pages, {(corpus / 1e6).toFixed(2)} MB of HTML),{' '}
      <code>@affordances/md</code>'s <code>htmlToMarkdown</code> converts every page in{' '}
      {time(md.total)} in all, {mbps(md.mbps)}. mdream takes {time(mdream.total)}, so md is{' '}
      {times(md.total, mdream.total)} slower than mdream (its converter alone,{' '}
      {times(core.total, mdream.total)}). It's {times(turndown.total, md.total)} faster than
      turndown ({time(turndown.total)}) and {times(nhm.total, md.total)} faster than
      node-html-markdown ({time(nhm.total)}). The last published version, {published}, took{' '}
      {time(before.total)}: {times(before.total, md.total)} as long as now.
    </p>
  )
}

// what the whole call adds to the converter's time, over the corpus
export const PerfOverhead = () => {
  const core = tool('md-core')
  return (
    <>
      Over the corpus, that work takes {time(md.total - core.total)} of the whole call's{' '}
      {time(md.total)}.
    </>
  )
}

// throughput, the whole corpus's bytes over its total time: the bars share one linear scale
export const PerfChart = () => {
  const top = Math.max(...rows.map((row) => row.tool.mbps))
  return (
    <AgentSkip>
      <figure className="not-typeset my-6 flex flex-col gap-2.5 rounded-(--radius) border p-5 max-[599px]:p-4">
        <figcaption className="mb-1 text-[0.8125rem] text-muted-foreground">
          Throughput over the whole corpus, MB/s (higher is faster)
        </figcaption>
        {rows.map((row, i) => (
          <div
            key={row.name}
            className="grid grid-cols-[9.5rem_1fr] items-center gap-3 max-[599px]:grid-cols-[6.5rem_1fr]"
          >
            <span className="truncate text-[0.8125rem]">
              {row.short === 'md' ? '@affordances/md' : row.short}
            </span>
            <div className="flex items-center gap-2">
              <div
                className={cn('h-4 rounded-sm', i < 3 ? 'bg-foreground' : 'bg-muted-foreground/50')}
                style={{ width: `${Math.max((row.tool.mbps / top) * 100, 0.5)}%` }}
              />
              <span className="shrink-0 font-mono text-xs tabular-nums">{rate(row.tool.mbps)}</span>
            </div>
          </div>
        ))}
      </figure>
    </AgentSkip>
  )
}

// each tool's total over the corpus, its throughput, and how much markdown it wrote
export const PerfTotals = () => (
  <TypeTable>
    <caption className="sr-only">
      Each tool's total time, throughput and output over the corpus
    </caption>
    <TableHeader>
      <TableRow className="hover:bg-transparent">
        {['Tool', 'Version', 'Total', 'Throughput', 'Output', 'Runs per page'].map((h, i) => (
          <TableHead key={h} scope="col" className={cn(th, i > 1 && 'text-right')}>
            {h}
          </TableHead>
        ))}
      </TableRow>
    </TableHeader>
    <TableBody>
      {rows.map((row) => (
        <TableRow key={row.name} className="hover:bg-transparent">
          <TableHead scope="row" className={cn(th, 'text-[0.8125rem] font-normal')}>
            {row.label}
          </TableHead>
          <TableCell className={td}>{row.version}</TableCell>
          <TableCell className={cn(td, num)}>{time(row.tool.total)}</TableCell>
          <TableCell className={cn(td, num)}>{mbps(row.tool.mbps)}</TableCell>
          <TableCell className={cn(td, num)}>{kb(row.tool.outBytes)}</TableCell>
          <TableCell className={cn(td, num)}>{runsOf(row.tool)}</TableCell>
        </TableRow>
      ))}
    </TableBody>
  </TypeTable>
)

// every page's median, in ms, per tool
export const PerfPages = () => (
  <TypeTable className="[&_td]:px-2 [&_th]:px-2">
    <caption className="sr-only">Median time per page, in milliseconds, per tool</caption>
    <TableHeader>
      <TableRow className="hover:bg-transparent">
        {['Page', 'Size', ...rows.map((row) => row.short)].map((h, i) => (
          <TableHead key={h} scope="col" className={cn(th, i > 0 && 'text-right')}>
            {h}
          </TableHead>
        ))}
      </TableRow>
    </TableHeader>
    <TableBody>
      {run.pages.map((page) => (
        <TableRow key={page.name} className="hover:bg-transparent">
          <TableHead scope="row" className={cn(th, 'text-[0.8125rem] font-normal')}>
            {page.name}
          </TableHead>
          <TableCell className={cn(td, num)}>{kb(page.bytes)}</TableCell>
          {rows.map((row) => (
            <TableCell key={row.name} className={cn(td, num)}>
              {ms(row.tool.pages[page.name]!.median)}
            </TableCell>
          ))}
        </TableRow>
      ))}
    </TableBody>
  </TypeTable>
)

// the run's own facts, for the method
export const PerfRun = () => (
  <ul>
    <li>
      The median of up to {run.runs} runs per page, after up to {run.warmup} warm-up runs
      {run.gc && ', with a full garbage collection before each tool on each page'}. A tool that has
      spent a second on a page stops there once it has 3 runs, so the slower tools have fewer (the
      totals table gives each tool's). The tool order rotates from page to page.
    </li>
    <li>
      Node.js {run.node} on {run.cpu}, on a quiet machine (load average {run.load.toFixed(2)} when
      it started), on {run.date.slice(0, 10)}.
    </li>
    <li>
      Measured at commit <code>{run.commit.slice(0, 8)}</code>.
    </li>
  </ul>
)

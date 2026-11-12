// speed benchmark: every tool on every corpus page, median of n timed runs per page
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { cpus } from 'node:os'
import { parseArgs } from 'node:util'
import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'
import { filterPages, loadCorpus, type Page } from './corpus.ts'
import { kb, ms, pct, table } from './table.ts'

const { values } = parseArgs({
  options: {
    runs: { type: 'string', default: '20' },
    warmup: { type: 'string', default: '3' },
    budget: { type: 'string', default: '300' },
    tool: { type: 'string' },
    page: { type: 'string' },
    json: { type: 'boolean', default: false },
    save: { type: 'string' },
    compare: { type: 'string' },
    'no-gc': { type: 'boolean', default: false },
  },
})

const runs = Number(values.runs)
const warmup = Number(values.warmup)
// a slow tool stops early once it has minRuns samples and has spent this long (ms) on one page: keeps a full run
// short. tools under ~15 ms a page, the ones the comparison is about, always get all their runs
const budget = Number(values.budget)
const minRuns = Math.min(3, runs)
const url = 'https://site.test/a'
const resultsDir = new URL('./.results/', import.meta.url)

// a full gc before every sample, so one tool's garbage is never collected on another's clock
let gc: (() => void) | undefined
if (!values['no-gc']) {
  setFlagsFromString('--expose-gc')
  gc = runInNewContext('gc') as () => void
}

// setup turns a page into the function that's timed; it may do untimed work first (emit needs a parsed tree)
type Tool = { name: string; setup: (html: string) => () => unknown }
type Status = 'ok' | 'not implemented' | `import failed: ${string}`

const tools: { tool: Tool; status: Status }[] = []
const add = (tool: Tool, status: Status = 'ok') => tools.push({ tool, status })
const failure = (error: unknown) => (error as Error).message.split('\n')[0] ?? String(error)

const isNotImplemented = (error: unknown) =>
  error instanceof Error && error.message.startsWith('not implemented')

// md-core is imported dynamically: it's mid-rewrite and must not take the whole bench down
try {
  const core = await import('../src/index.ts')
  add({ name: 'md-core', setup: (html) => () => core.htmlToMarkdown(html, { url }).markdown })
} catch (error) {
  add({ name: 'md-core', setup: () => () => '' }, `import failed: ${failure(error)}`)
}

// the two stages on their own, when they exist. missing files are skipped without a word; a file that exists but
// fails to load is reported, since that's a bug, not a missing stage
const stage = async (file: string) => {
  const target = new URL(file, import.meta.url)
  try {
    return (await import(target.href)) as Record<string, unknown>
  } catch (error) {
    const err = error as { code?: string; url?: string; message: string }
    if (err.code === 'ERR_MODULE_NOT_FOUND' && err.message.includes(target.pathname))
      return undefined
    console.error(`${file}: failed to load: ${failure(error)}`)
    return undefined
  }
}
const parseMod = await stage('../src/parse.ts')
const emitMod = await stage('../src/emit.ts')
const parse =
  typeof parseMod?.parse === 'function' ? (parseMod.parse as (h: string) => unknown) : undefined
const emit =
  typeof emitMod?.emit === 'function'
    ? (emitMod.emit as (doc: unknown, options: { url: string }) => unknown)
    : undefined
if (parse) add({ name: 'md-core parse', setup: (html) => () => parse(html) })
if (parse && emit) {
  // the tree is parsed once, outside the clock. emit runs on the same tree each time, so anything it caches on the
  // tree (attr maps) is warm after the first run
  add({
    name: 'md-core emit',
    setup: (html) => {
      const doc = parse(html)
      return () => emit(doc, { url })
    },
  })
}

{
  const md = await import('@affordances/md')
  add({ name: '@affordances/md', setup: (html) => () => md.htmlToMarkdown(html, { url }).markdown })
  const mdream = await import('mdream')
  add({
    name: 'mdream',
    setup: (html) => () => mdream.htmlToMarkdown(html, { origin: 'https://site.test' }),
  })
  const { default: Turndown } = await import('turndown')
  const { gfm } = await import('turndown-plugin-gfm')
  const turndown = new Turndown().use(gfm)
  add({ name: 'turndown+gfm', setup: (html) => () => turndown.turndown(html) })
  const { NodeHtmlMarkdown } = await import('node-html-markdown')
  const nhm = new NodeHtmlMarkdown()
  add({ name: 'node-html-markdown', setup: (html) => () => nhm.translate(html) })
}

// comma-separated substrings, any of which selects a tool: --tool core,mdream is the quick loop
const wanted = values.tool?.toLowerCase().split(',').filter(Boolean)
const selected = wanted
  ? tools.filter(({ tool }) => wanted.some((w) => tool.name.toLowerCase().includes(w)))
  : tools
const corpus = loadCorpus()
const pages = filterPages(corpus, values.page)
if (!corpus.some((p) => p.url))
  console.error('no real pages in bench/corpus/.cache: run `node bench/fetch.ts` (synthetic only)')
if (!pages.length || !selected.length) {
  console.error('nothing to run: check --tool and --page')
  process.exit(1)
}

// every output goes here, so no engine can prove a result unused and skip the work
let sink = 0
const keep = (out: unknown) => {
  if (typeof out === 'string') sink += out.length
  else if (out !== null && typeof out === 'object') sink += 1
  return out
}
const outBytes = (out: unknown) => (typeof out === 'string' ? Buffer.byteLength(out) : undefined)

type Cell = {
  median: number
  p25: number
  p75: number
  runs: number
  outBytes?: number | undefined
  error?: string | undefined
}
type ToolResult = {
  name: string
  status: Status
  total?: number
  mbps?: number
  outBytes?: number
  spread?: number
  pages: Record<string, Cell>
}
type Run = {
  date: string
  node: string
  cpu: string
  runs: number
  warmup: number
  gc: boolean
  pages: { name: string; bytes: number }[]
  tools: ToolResult[]
}

const delta = (now: number | undefined, then: number | undefined) =>
  now !== undefined && then ? ` (${pct(now / then - 1)})` : ''

const quantile = (sorted: number[], q: number) => {
  const i = (sorted.length - 1) * q
  const lo = Math.floor(i)
  const hi = Math.ceil(i)
  return (sorted[lo] ?? 0) + ((sorted[hi] ?? 0) - (sorted[lo] ?? 0)) * (i - lo)
}

const live = selected.map(({ tool, status }) => ({
  tool,
  status,
  cells: {} as Record<string, Cell>,
}))

// one untimed pass over the corpus first (capped at half a second a tool): the jit sees every kind of page before
// any timing, and it finds tools that can't run at all
for (const entry of live) {
  if (entry.status !== 'ok') continue
  const t0 = performance.now()
  for (const page of pages) {
    if (performance.now() - t0 > 500) break
    try {
      keep(entry.tool.setup(page.html)())
    } catch (error) {
      if (isNotImplemented(error)) {
        entry.status = 'not implemented'
        break
      }
    }
  }
}

// one tool at a time per page: a full gc, warm-up runs (which also regrow the heap the gc shrank: a gc before every
// sample measured @affordances/md ~50% slow), then the timed runs back to back, so each tool is timed in its own
// steady state and pays only for its own garbage. the tool order rotates page by page, so drift over the run (thermal,
// other load) doesn't always land on the same tool
const bench = (page: Page, index: number) => {
  const active = live.filter((e) => e.status === 'ok')
  for (let k = 0; k < active.length; k++) {
    const e = active[(index + k) % active.length]!
    gc?.()
    const samples: number[] = []
    let out: unknown
    let error: string | undefined
    try {
      const fn = e.tool.setup(page.html)
      for (let w = 0, spent = 0; w < warmup && (w === 0 || spent < budget / 2); w++) {
        const t0 = performance.now()
        out = keep(fn())
        spent += performance.now() - t0
      }
      for (let r = 0, spent = 0; r < runs && (r < minRuns || spent < budget); r++) {
        const t0 = performance.now()
        const result = fn()
        const dt = performance.now() - t0
        keep(result)
        samples.push(dt)
        spent += dt
      }
    } catch (err) {
      error = failure(err)
    }
    const sorted = samples.toSorted((a, b) => a - b)
    e.cells[page.name] = error
      ? { median: 0, p25: 0, p75: 0, runs: 0, error }
      : {
          median: quantile(sorted, 0.5),
          p25: quantile(sorted, 0.25),
          p75: quantile(sorted, 0.75),
          runs: sorted.length,
          outBytes: outBytes(out),
        }
  }
}

const progress = !values.json && process.stderr.isTTY
for (const [i, page] of pages.entries()) {
  if (progress) process.stderr.write(`\r\x1b[Ktiming ${page.name}`)
  bench(page, i)
}
if (progress) process.stderr.write('\r\x1b[K')

const bytes = new Map(pages.map((p) => [p.name, Buffer.byteLength(p.html)]))
const result: Run = {
  date: new Date().toISOString(),
  node: process.version,
  cpu: cpus()[0]?.model ?? 'unknown',
  runs,
  warmup,
  gc: Boolean(gc),
  pages: pages.map((p) => ({ name: p.name, bytes: bytes.get(p.name) ?? 0 })),
  tools: live.map((e) => {
    const r: ToolResult = { name: e.tool.name, status: e.status, pages: e.cells }
    const ok = Object.entries(e.cells).filter(([, c]) => !c.error)
    if (e.status === 'ok' && ok.length) {
      r.total = ok.reduce((s, [, c]) => s + c.median, 0)
      r.mbps = ok.reduce((s, [n]) => s + (bytes.get(n) ?? 0), 0) / 1e6 / (r.total / 1000)
      r.outBytes = ok.reduce((s, [, c]) => s + (c.outBytes ?? 0), 0)
      r.spread = ok.reduce((s, [, c]) => s + (c.p75 - c.p25), 0) / r.total
    }
    return r
  }),
}

if (values.save) {
  mkdirSync(resultsDir, { recursive: true })
  writeFileSync(new URL(`${values.save}.json`, resultsDir), JSON.stringify(result, null, 2) + '\n')
}

let base: Run | undefined
if (values.compare) {
  try {
    base = JSON.parse(readFileSync(new URL(`${values.compare}.json`, resultsDir), 'utf8')) as Run
  } catch {
    console.error(`no saved run '${values.compare}' in bench/.results`)
    process.exit(1)
  }
}

// no process.exit after a big write: it can cut off output going to a pipe
if (values.json) console.log(JSON.stringify(result, null, 2))
else {
  const errors = (r: ToolResult) => Object.values(r.pages).filter((c) => c.error).length
  const complete = (r: ToolResult) => r.status === 'ok' && errors(r) === 0
  const rank = (r: ToolResult) => (r.status !== 'ok' ? 2 : errors(r) ? 1 : 0)
  // the stage rows sit under md-core, since they're parts of it, not rivals
  const isStage = (t: ToolResult) => t.name.startsWith('md-core ')
  const sorted = result.tools
    .filter((t) => !isStage(t))
    .toSorted((a, b) => rank(a) - rank(b) || (a.total ?? Infinity) - (b.total ?? Infinity))
    .flatMap((t) => (t.name === 'md-core' ? [t, ...result.tools.filter(isStage)] : [t]))
  if (!sorted.some((t) => t.name === 'md-core')) sorted.push(...result.tools.filter(isStage))
  const baseTool = (name: string) => base?.tools.find((t) => t.name === name)

  const cell = (t: ToolResult, page: string) => {
    const c = t.pages[page]
    if (t.status !== 'ok') return '-'
    if (!c) return ''
    if (c.error) return 'error'
    return ms(c.median) + delta(c.median, baseTool(t.name)?.pages[page]?.median)
  }

  console.log(
    `median ms per page; ${runs} runs after ${warmup} warm-up${gc ? ', gc before each tool on each page' : ''}; ${result.node}, ${result.cpu}${base ? `; deltas vs '${values.compare}' (${base.date.slice(0, 16)})` : ''}\n`,
  )
  console.log(
    table(
      ['page', 'KB', ...sorted.map((t) => t.name)],
      pages.map((p) => [p.name, kb(bytes.get(p.name) ?? 0), ...sorted.map((t) => cell(t, p.name))]),
    ),
  )
  console.log()

  const totalBytes = [...bytes.values()].reduce((a, b) => a + b, 0)
  console.log(
    table(
      ['tool', 'total ms', 'MB/s', 'out KB', 'spread', 'runs', 'notes'],
      sorted.map((t) => {
        if (t.status !== 'ok') return [t.name, '-', '-', '-', '-', '-', t.status]
        const cells = Object.values(t.pages).filter((c) => !c.error)
        const counts = cells.map((c) => c.runs)
        const n = errors(t)
        const prev = baseTool(t.name)
        const samePages =
          prev && result.pages.every((p) => prev.pages[p.name] && !prev.pages[p.name]!.error)
        const notes = [
          n ? `errors on ${n} page${n > 1 ? 's' : ''} (total is partial)` : '',
          prev && !samePages ? 'different pages from the saved run' : '',
        ].filter(Boolean)
        return [
          t.name,
          (t.total === undefined ? '-' : ms(t.total)) +
            (samePages && complete(t) ? delta(t.total, prev?.total) : ''),
          t.mbps?.toFixed(1) ?? '-',
          kb(t.outBytes ?? 0),
          t.spread === undefined ? '-' : `±${(t.spread * 50).toFixed(0)}%`,
          counts.length ? `${Math.min(...counts)}-${Math.max(...counts)}` : '-',
          notes.join('; '),
        ]
      }),
      ['notes'],
    ),
  )
  console.log(`\ncorpus: ${pages.length} pages, ${(totalBytes / 1e6).toFixed(2)} MB`)

  const errorLines = result.tools.flatMap((t) =>
    Object.entries(t.pages)
      .filter(([, c]) => c.error)
      .map(([page, c]) => `  ${t.name} on ${page}: ${c.error}`),
  )
  if (errorLines.length) console.log(`\nerrors:\n${errorLines.join('\n')}`)

  const core = result.tools.find((t) => t.name === 'md-core')
  const mdream = result.tools.find((t) => t.name === 'mdream')
  if (core && mdream) {
    if (core.status !== 'ok') console.log(`\nmd-core / mdream: md-core ${core.status}`)
    else if (!complete(core) || !complete(mdream) || !core.total || !mdream.total)
      console.log('\nmd-core / mdream: not comparable (errors on some pages)')
    else {
      const ratio = core.total / mdream.total
      console.log(
        `\nmd-core / mdream: ${ratio.toFixed(2)}x (${ratio <= 1 ? `${(1 / ratio).toFixed(2)}x faster` : `${ratio.toFixed(2)}x slower`})`,
      )
    }
  }
}

// read, so the sink is observably used
if (sink < 0) console.log(sink)

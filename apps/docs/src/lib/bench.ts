import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const dir = path.join(process.cwd(), '../bench/results')

// committed bench runs, read when the page is prerendered; none until the first run lands
export const benchResults = (): { file: string; data: unknown }[] => {
  let files: string[]
  try {
    files = readdirSync(dir).filter((file) => file.endsWith('.json'))
  } catch {
    return []
  }
  return files.toSorted().map((file) => ({
    file,
    data: JSON.parse(readFileSync(path.join(dir, file), 'utf8')),
  }))
}

type Side = { successRate: number; medianTurns: number; medianTokens: number; medianMs: number }
export type BenchSummary = {
  file: string
  model?: string
  runs?: number
  tasks: number
  browser: Side
  afford: Side
}

const isSide = (value: unknown): value is Side =>
  !!value &&
  ['successRate', 'medianTurns', 'medianTokens', 'medianMs'].every(
    (key) => typeof (value as Record<string, unknown>)[key] === 'number',
  )

// the model the site's headline numbers come from; other models' runs live alongside on the bench page
export const HEADLINE_MODEL = 'claude-opus-5-5'

// the newest committed run of `model`, when it has a summary in the shape apps/bench writes; null otherwise,
// so nothing is shown that the bench didn't measure. newest by finishedAt (older files have none and lose)
export const latestBench = (model = HEADLINE_MODEL): BenchSummary | null => {
  type Run = {
    model?: string
    runs?: number
    finishedAt?: string
    tasks?: unknown[]
    summary?: { browser?: unknown; afford?: unknown }
  }
  const latest = benchResults()
    .filter(({ data }) => (data as Run).model === model && !(data as { partial?: boolean }).partial)
    .toSorted(
      (a, b) =>
        ((a.data as Run).finishedAt ?? '').localeCompare((b.data as Run).finishedAt ?? '') ||
        a.file.localeCompare(b.file),
    )
    .at(-1)
  const data = latest?.data as Run | undefined
  if (!latest || !data || !isSide(data.summary?.browser) || !isSide(data.summary?.afford))
    return null
  return {
    file: latest.file,
    model: data.model,
    runs: data.runs,
    tasks: data.tasks?.length ?? 0,
    browser: data.summary.browser,
    afford: data.summary.afford,
  }
}

// medians per run, by how the model was billed for them
export type TokenSplit = { input: number; cacheRead: number; cacheWrite: number; output: number }

// one agent's numbers, per task or overall. ranges, cost, and the split only when the run recorded them
export type BenchAgent = {
  tokens: number
  ms: number
  turns: number
  successRate: number
  costPerSuccessUsd?: number
  tokenRange?: [number, number]
  msRange?: [number, number]
  tokenSplit?: TokenSplit
}
export type BenchTask = {
  id: string
  name: string
  prompt?: string
  browser: BenchAgent
  afford: BenchAgent
}
export type BenchRun = {
  file: string
  model: string
  runs: number
  finishedAt?: string
  commit?: string
  dirty?: boolean
  browser: BenchAgent
  afford: BenchAgent
  tasks: BenchTask[]
}

type Spread = { min?: unknown; max?: unknown }
type RawSide = Side & {
  costPerSuccessUsd?: unknown
  tokens?: Spread
  ms?: Spread
  tokenSplit?: Record<string, unknown>
}
type RawRow = {
  agent?: string
  task?: string
  tokens?: number
  inputTokens?: number
  outputTokens?: number
  ms?: number
  turns?: number
  success?: boolean
}

// the same median apps/bench uses
const median = (xs: number[]) => {
  const s = xs.toSorted((a, b) => a - b)
  return s.length ? (s[Math.floor((s.length - 1) / 2)]! + s[Math.ceil((s.length - 1) / 2)]!) / 2 : 0
}
const range = (spread?: Spread): [number, number] | undefined =>
  typeof spread?.min === 'number' && typeof spread.max === 'number'
    ? [spread.min, spread.max]
    : undefined
const fromSide = (side: RawSide): BenchAgent => ({
  tokens: side.medianTokens,
  ms: side.medianMs,
  turns: side.medianTurns,
  successRate: side.successRate,
  costPerSuccessUsd:
    typeof side.costPerSuccessUsd === 'number' ? side.costPerSuccessUsd : undefined,
  tokenRange: range(side.tokens),
  msRange: range(side.ms),
  tokenSplit: (['input', 'cacheRead', 'cacheWrite', 'output'] as const).every(
    (k) => typeof side.tokenSplit?.[k] === 'number',
  )
    ? (side.tokenSplit as TokenSplit)
    : undefined,
})
// older runs have no perTask; their rows hold the same measurements, so take the medians from those
const fromRows = (rows: RawRow[]): BenchAgent | null => {
  if (!rows.length) return null
  const tokens = rows.map((r) => r.tokens ?? (r.inputTokens ?? 0) + (r.outputTokens ?? 0))
  const ms = rows.map((r) => r.ms ?? 0)
  return {
    tokens: median(tokens),
    ms: median(ms),
    turns: median(rows.map((r) => r.turns ?? 0)),
    successRate: rows.filter((r) => r.success).length / rows.length,
    tokenRange: [Math.min(...tokens), Math.max(...tokens)],
    msRange: [Math.min(...ms), Math.max(...ms)],
  }
}

// the newest committed run of every model, headline model first. a file without a summary in the shape
// apps/bench writes is skipped, so nothing is shown that the bench didn't measure
export const benchRuns = (): BenchRun[] => {
  type Run = {
    model?: string
    runs?: number
    finishedAt?: string
    commit?: { sha?: string; dirty?: boolean }
    tasks?: { id?: string; prompt?: string }[]
    summary?: { browser?: unknown; afford?: unknown }
    perTask?: Record<string, { browser?: unknown; afford?: unknown }>
    rows?: RawRow[]
    // a --tasks subset: shown on the bench page, never as a model's headline run
    partial?: boolean
  }
  const newest = new Map<string, { file: string; data: Run }>()
  for (const { file, data } of benchResults()) {
    const run = data as Run
    if (
      typeof run.model !== 'string' ||
      run.partial ||
      !isSide(run.summary?.browser) ||
      !isSide(run.summary?.afford)
    )
      continue
    const seen = newest.get(run.model)
    const key = (r: { file: string; data: Run }) => `${r.data.finishedAt ?? ''}\0${r.file}`
    if (!seen || key(seen) < key({ file, data: run })) newest.set(run.model, { file, data: run })
  }
  return [...newest.values()]
    .map(({ file, data }) => {
      const rows = data.rows ?? []
      const agent = (id: string, kind: 'browser' | 'afford') => {
        const side = data.perTask?.[id]?.[kind]
        return isSide(side)
          ? fromSide(side as RawSide)
          : fromRows(rows.filter((r) => r.task === id && r.agent === kind))
      }
      const tasks = (data.tasks ?? []).flatMap(({ id, prompt }) => {
        if (!id) return []
        const browser = agent(id, 'browser')
        const afford = agent(id, 'afford')
        return browser && afford ? [{ id, name: taskName(id), prompt, browser, afford }] : []
      })
      return {
        file,
        model: data.model!,
        runs: data.runs ?? 1,
        finishedAt: data.finishedAt,
        commit: data.commit?.sha?.slice(0, 7),
        dirty: data.commit?.dirty,
        browser: fromSide(data.summary!.browser as RawSide),
        afford: fromSide(data.summary!.afford as RawSide),
        tasks,
      }
    })
    .toSorted(
      (a, b) =>
        Number(b.model === HEADLINE_MODEL) - Number(a.model === HEADLINE_MODEL) ||
        a.model.localeCompare(b.model),
    )
}

// every committed file, newest first: what it ran, against which commit, and its overall medians where the
// file has them. partial runs (a --tasks subset) included, so the index's iterations read in order
export type BenchFile = {
  file: string
  model?: string
  runs?: number
  finishedAt?: string
  commit?: string
  dirty?: boolean
  partial: boolean
  tasks: string[]
  browser?: Side
  afford?: Side
}
const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
export const benchHistory = (): BenchFile[] =>
  benchResults()
    .map(({ file, data }) => {
      const run = data as {
        model?: unknown
        runs?: unknown
        finishedAt?: unknown
        commit?: { sha?: unknown; dirty?: unknown }
        partial?: unknown
        tasks?: { id?: unknown }[]
        summary?: { browser?: unknown; afford?: unknown }
      }
      return {
        file,
        model: str(run.model),
        runs: typeof run.runs === 'number' ? run.runs : undefined,
        finishedAt: str(run.finishedAt),
        commit: str(run.commit?.sha)?.slice(0, 7),
        dirty: typeof run.commit?.dirty === 'boolean' ? run.commit.dirty : undefined,
        partial: run.partial === true,
        tasks: (Array.isArray(run.tasks) ? run.tasks : []).flatMap((t) => str(t?.id) ?? []),
        browser: isSide(run.summary?.browser) ? run.summary.browser : undefined,
        afford: isSide(run.summary?.afford) ? run.summary.afford : undefined,
      }
    })
    // newest first; files from before finishedAt was recorded go last, by name
    .toSorted(
      (a, b) =>
        (b.finishedAt ?? '').localeCompare(a.finishedAt ?? '') || b.file.localeCompare(a.file),
    )

// add-to-cart → Add to cart
export const taskName = (id: string) => id[0]!.toUpperCase() + id.slice(1).replaceAll('-', ' ')

// claude-haiku-5-5 → Claude Haiku 5.5; anything else as written
export const modelName = (model: string) => {
  const m = model.match(/^claude-([a-z]+)-(\d+)-(\d+)$/)
  return m ? `Claude ${m[1]![0]!.toUpperCase()}${m[1]!.slice(1)} ${m[2]}.${m[3]}` : model
}

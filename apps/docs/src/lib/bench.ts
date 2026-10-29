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

// the newest committed run's summary, when it has one in the shape apps/bench writes; null otherwise,
// so nothing is shown that the bench didn't measure
export const latestBench = (): BenchSummary | null => {
  const latest = benchResults().at(-1)
  const data = latest?.data as
    | {
        model?: string
        runs?: number
        tasks?: unknown[]
        summary?: { browser?: unknown; afford?: unknown }
      }
    | undefined
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

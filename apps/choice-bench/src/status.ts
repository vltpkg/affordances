import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { faultsOf, priorFailures, type TrialSpec } from './harness.ts'

// a run's status, mid-run or after (intake's liveness rule, 2026-11-18 18:18Z; the planner's row 9647438a): only
// NON-OUTCOME fields, each named here, never choice, completed, intended or any scored or labelled field. A trace's
// metrics line is never parsed: it's recognized by its prefix and skipped unread, and so is anything else this file
// doesn't name. Read-only, from disk, so it's safe while a run is going

/** The fields a status line may carry, and nothing else. */
export const STATUS_FIELDS = [
  'id',
  'surface',
  'model',
  'state',
  'resolved',
  'end',
  'calls',
  'durationMs',
  'tokens',
  'faults',
  'attempts',
] as const
export type StatusLine = Partial<Record<(typeof STATUS_FIELDS)[number], string | number | null>>

const METRICS_PREFIX = '{"kind":"metrics"'

// a scored trace's non-outcome fields: from its trial line, its end line, and the number of its call lines
const traceStatus = (file: string) => {
  let resolved: string | null = null
  let end: string | null = null
  let durationMs: number | null = null
  let tokens: number | null = null
  let calls = 0
  let complete = false
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line || line.startsWith(METRICS_PREFIX)) {
      if (line) complete = true
      continue
    }
    let kind: string | undefined
    try {
      kind = (JSON.parse(line) as { kind?: string }).kind
    } catch {
      continue
    }
    if (kind === 'call') calls++
    else if (kind === 'trial')
      resolved = ((JSON.parse(line) as { model?: { resolved?: string } }).model?.resolved ??
        null) as string | null
    else if (kind === 'end') {
      const e = JSON.parse(line) as { end?: string; durationMs?: number; totalTokens?: number }
      end = e.end ?? null
      durationMs = e.durationMs === undefined ? null : Math.round(e.durationMs)
      tokens = e.totalTokens ?? null
    }
  }
  return { complete, resolved, end, durationMs, tokens, calls }
}

/** Each spec's status line, in the plan's order. */
export const statusOf = (out: string, specs: TrialSpec[]): StatusLine[] => {
  const faults = faultsOf(out)
  return specs.map((s) => {
    const base: StatusLine = {
      id: s.id,
      surface: s.surface ?? null,
      model: s.model,
      faults: faults.filter((f) => f.spec.id === s.id).length,
      attempts: faults.filter((f) => f.spec.id === s.id).length + priorFailures(out, s.id),
    }
    const trace = path.join(out, `${s.id}.jsonl`)
    if (existsSync(trace)) {
      const t = traceStatus(trace)
      if (t.complete)
        return {
          ...base,
          state: 'scored',
          resolved: t.resolved,
          end: t.end,
          calls: t.calls,
          durationMs: t.durationMs,
          tokens: t.tokens,
        }
    }
    return {
      ...base,
      state: existsSync(path.join(out, `${s.id}.server.json`)) ? 'running' : 'pending',
    }
  })
}

/** Counts per cell, surface and model: never an outcome. */
export const cellTotals = (lines: StatusLine[]) => {
  const cells = new Map<string, Record<string, number>>()
  for (const l of lines) {
    const key = `${l.surface} ${l.model}`
    const c = cells.get(key) ?? {
      scored: 0,
      running: 0,
      pending: 0,
      faults: 0,
      endedFailed: 0,
      endedCapped: 0,
    }
    c[String(l.state)] = (c[String(l.state)] ?? 0) + 1
    c.faults! += Number(l.faults ?? 0)
    if (l.end === 'failed') c.endedFailed!++
    if (l.end === 'capped') c.endedCapped!++
    cells.set(key, c)
  }
  return Object.fromEntries(cells)
}

import { existsSync } from 'node:fs'
import path from 'node:path'
import { faultsOf, priorFailures, readTrace, type TrialSpec } from './harness.ts'

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

// a scored trace's non-outcome fields: from its trial line, its end line, and the number of its call lines. The
// shared reader leaves the metrics line unparsed, and this never asks for it
const traceStatus = (file: string) => {
  const t = readTrace(file)
  const e = t?.end as { end?: string; durationMs?: number; totalTokens?: number } | undefined
  return {
    complete: t?.metrics !== undefined,
    resolved: ((t?.trial as { model?: { resolved?: string } } | undefined)?.model?.resolved ??
      null) as string | null,
    end: e?.end ?? null,
    durationMs: e?.durationMs === undefined ? null : Math.round(e.durationMs),
    tokens: e?.totalTokens ?? null,
    calls: t?.calls ?? 0,
  }
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

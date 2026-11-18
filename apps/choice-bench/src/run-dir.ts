import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { RUN_PLANS } from './surface-plan.ts'

// one plan per run directory (review, 18:42Z): analyze.py reads every top-level trace in a directory, so a launch or
// resume of one plan into another's directory would silently mix them. Each launch record names its plan; the pilot's,
// written before it did, is the pilot's

export type PlanName = keyof typeof RUN_PLANS

const launches = (out: string) =>
  existsSync(out)
    ? readdirSync(out)
        .filter((f) => /^launch-\d+\.json$/.test(f))
        .map((f) => JSON.parse(readFileSync(path.join(out, f), 'utf8')) as { plan?: PlanName })
    : []

/** The plan a run directory holds: its first launch record's, the pilot's if that record predates the field. */
export const planOfDir = (out: string): PlanName | undefined => {
  const first = launches(out)[0]
  return first ? (first.plan ?? 'pilot') : undefined
}

/** Why a launch or resume of this plan into this directory must refuse, before anything is written; or undefined. */
export const planMismatch = (out: string, plan: PlanName): string | undefined => {
  const other = [...new Set(launches(out).map((l) => l.plan ?? 'pilot'))].filter((p) => p !== plan)
  if (other.length)
    return `${out} holds a ${other.join(' and ')} run, not ${plan}: one plan per directory`
  if (!existsSync(out)) return undefined
  const ids = new Set(RUN_PLANS[plan].specs('fake').map((s) => s.id))
  const strays = readdirSync(out).filter(
    (f) => f.endsWith('.jsonl') && !ids.has(f.slice(0, -'.jsonl'.length)),
  )
  if (strays.length)
    return `${out} holds traces that aren't ${plan}'s: ${strays.slice(0, 3).join(', ')}`
  return undefined
}

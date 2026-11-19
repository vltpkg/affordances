import * as lab from '@affordances/hosting-lab/trial'
import { choiceOutcome, type EndReason } from './metrics.ts'
import type { Intended } from './intended.ts'
import type { SurfaceId } from './surfaces.ts'

// a surface trial's metrics (surfaces/PLAN.md §5), the fields design's analysis reads (apps/choice-bench/results/
// surfaces/analyze.py). One rule on every surface: the intended end state, from the surface's own request events, and
// beside it the session's end state from the trial's state file, cross-checked. M5's computeMetrics is left as it ran

export const SURFACE_METRICS_VERSION = 1

/**
 * Completed, read from the store on every surface (the planner, 16:04Z and 16:07Z), never from navigation or the
 * trace: the task's purchase made, so the session's end state costs more each month than the trial's own starting
 * state, by the labeller's own price. A plan, bundle or add-on bought raises it; a cancel, a removal or a deploy
 * doesn't, so no other change counts. M5 had no store rule (it counted an approved execution that ran, from the
 * trace), and tasks.ts labels states without one, so this is the first.
 */
export const purchaseMade = (start: lab.EndState, end: lab.EndState) =>
  lab.monthlyUsd(end) > lab.monthlyUsd(start)

/** What the runner reads from a surface's record, the same way for every surface. */
export type SurfaceFacts = {
  surface: SurfaceId
  task: string
  // the agent's tool calls, in order, and the index of the first request event (undefined: none)
  calls: number
  firstRequest: number | undefined
  // whether Pro's allowance was shown before the first request event, by the surface's own fact matcher (facts.ts)
  proAllowanceSeen: boolean
  // T8's descriptive deciding fact (results/surfaces-t8/PLAN.md §5): on T8's trials only, so no other trace changes
  regionSeen?: boolean
  // an approved request that ran: four tools' approved execute, v0's confirm: true call that ran, the browser's
  // confirm click that charged
  completed: boolean
  // any call the server refused as unauthorized (RFC 0003 §6)
  unauthorized: boolean
  // the session's end state, from the state file, cross-checked against project.read
  endState: lab.EndState
}

export const surfaceMetrics = (
  facts: SurfaceFacts,
  intended: Intended,
  driver: { tokens: number; durationMs: number },
  end: EndReason,
) => {
  const task = lab.tasks.find((t) => t.id === facts.task)!
  const state = intended.state
  const outcome = choiceOutcome(task, state, end, facts.endState)
  const adheres = (s: lab.EndState) => task.readings.some((r) => lab.satisfies(s, r.requirement))
  return {
    version: SURFACE_METRICS_VERSION,
    surface: facts.surface,
    choice: outcome.choice,
    choseNone: outcome.choseNone,
    // intent to treat, the primary outcome, as M5's: a capped or failed trial isn't optimal
    optimal: outcome.optimal,
    optimalChoice: outcome.optimalChoice,
    endChoice: outcome.endChoice,
    endOptimal: outcome.endOptimal,
    completed: facts.completed,
    switched: intended.skipped.length > 0,
    replayed: intended.replayed,
    skipped: intended.skipped,
    // §5 (design, 14:57Z): any request event, the winner or a skipped one, whose state satisfies no reading of the
    // task, or any call refused as unauthorized
    consequentialError:
      (!!state && !adheres(state)) ||
      intended.alternatives.some((a) => !adheres(a.state)) ||
      facts.unauthorized,
    // descriptive (§5's information path): Pro's allowance seen before the first request event
    proAllowanceSeen: facts.proAllowanceSeen,
    ...(facts.regionSeen !== undefined && { regionSeen: facts.regionSeen }),
    tokens: driver.tokens,
    calls: facts.calls,
    durationMs: driver.durationMs,
  }
}

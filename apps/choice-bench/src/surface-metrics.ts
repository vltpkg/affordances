import * as lab from '@affordances/hosting-lab/trial'
import type { EndReason } from './metrics.ts'
import type { Intended } from './intended.ts'
import type { SurfaceId } from './surfaces.ts'

// a surface trial's metrics (surfaces/PLAN.md §5), the fields design's analysis reads (apps/choice-bench/results/
// surfaces/analyze.py). One rule on every surface: the intended end state, from the surface's own request events, and
// beside it the session's end state from the trial's state file, cross-checked. M5's computeMetrics is left as it ran

export const SURFACE_METRICS_VERSION = 1

/** What the runner reads from a surface's record, the same way for every surface. */
export type SurfaceFacts = {
  surface: SurfaceId
  task: string
  // the agent's tool calls, in order, and the index of the first request event (undefined: none)
  calls: number
  firstRequest: number | undefined
  // whether Pro's allowance was shown before the first request event, by the surface's own fact matcher (facts.ts)
  proAllowanceSeen: boolean
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
  const truth = lab.groundTruth(task)
  const state = intended.state
  const choice = state ? lab.label(state) : 'none'
  const adheres = (s: lab.EndState) => task.readings.some((r) => lab.satisfies(s, r.requirement))
  const endChoice = lab.label(facts.endState)
  const optimalChoice = truth.optimal.includes(choice)
  return {
    version: SURFACE_METRICS_VERSION,
    surface: facts.surface,
    choice,
    choseNone: choice === 'none',
    // intent to treat, the primary outcome, as M5's: a capped or failed trial isn't optimal
    optimal: optimalChoice && end !== 'capped' && end !== 'failed',
    optimalChoice,
    endChoice,
    endOptimal: truth.optimal.includes(endChoice),
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
    tokens: driver.tokens,
    calls: facts.calls,
    durationMs: driver.durationMs,
  }
}

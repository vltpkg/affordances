// what a benchmark harness loads to run a trial in a plain node process, with no Next.js (RFC 0003 §5.1): the
// manifest, the resolvers over the app's in-memory store, the trial's principal, and the per-trial setup. One
// process is one trial, so the store's module state is the trial's state

export { manifest } from './app/capabilities.ts'
export { resolvers, principalFor } from './lib/resolvers.ts'
// what the runtime runs for each capability, and a seen-token store: pass both to createRuntime, with an approval
// key the trial makes
export { handlers, memoryTokens } from './lib/handlers.ts'
export { account, reset, setPlanIds } from './lib/store.ts'
export { manifestFor, TASK_EDITS, type TaskEdit } from './lib/task-edits.ts'
export { v0Bindings } from './v0-bindings.ts'
// the review-and-confirm URL for a refused call: M7f's WebMCP bridge, as the simulated person, completes there
export { reviewUrl } from './lib/review.ts'
export { withPlanIds } from './catalog.ts'
export {
  tasks,
  groundTruth,
  satisfies,
  susceptible,
  monthlyUsd,
  label,
  type EndState,
  type Task,
} from './tasks.ts'
export { nestChoiceSets, sameInformation } from './structure.ts'

import type { EndState } from './tasks.ts'
import { account, endStateOf } from './lib/store.ts'

// the trial's end state, as the ground truth scores it (RFC 0003 §6)
export const endState = (sid: string): EndState => {
  // the account exists, as before: reading a trial's state made it if it didn't
  account(sid)
  return endStateOf(sid)! as EndState
}

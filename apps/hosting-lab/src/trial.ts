// what a benchmark harness loads to run a trial in a plain node process, with no Next.js (RFC 0003 §5.1): the
// manifest, the resolvers over the app's in-memory store, the trial's principal, and the per-trial setup. One
// process is one trial, so the store's module state is the trial's state

export { manifest } from './manifest.ts'
export { resolvers, principalFor } from './lib/resolvers.ts'
export { account, reset, setPlanIds } from './lib/store.ts'
export { withPlanIds } from './catalog.ts'
export {
  tasks,
  groundTruth,
  susceptible,
  monthlyUsd,
  label,
  type EndState,
  type Task,
} from './tasks.ts'
export { nestChoiceSets, sameInformation } from './structure.ts'

import type { EndState } from './tasks.ts'
import { account } from './lib/store.ts'

// the trial's end state, as the ground truth scores it (RFC 0003 §6)
export const endState = (sid: string): EndState => {
  const { project } = account(sid)
  return { plan: project.plan, bundle: project.bundle, addOns: project.addOns.toSorted() }
}

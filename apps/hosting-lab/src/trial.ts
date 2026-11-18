// what a benchmark harness loads to run a trial in a plain node process, with no Next.js (RFC 0003 §5.1): the
// manifest, the resolvers over the app's in-memory store, the trial's principal, and the per-trial setup. One
// process is one trial, so the store's module state is the trial's state

export { manifest } from './manifest.ts'
export { resolvers, principalFor } from './lib/resolvers.ts'
// what the runtime runs for each capability, and a seen-token store: pass both to createRuntime, with an approval
// key the trial makes
export { handlers, memoryTokens } from './lib/handlers.ts'
export { account, reset, setPlanIds } from './lib/store.ts'
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

import { createRuntime } from '@affordances/runtime'
import { handlers, memoryTokens } from './lib/handlers.ts'
import { principalFor as principalOf, resolvers } from './lib/resolvers.ts'
import { manifest } from './manifest.ts'
import { account, dryRun, effectiveAddOns } from './lib/store.ts'
import { label as labelOf, type EndState } from './tasks.ts'

// the trial's end state, as the ground truth scores it (RFC 0003 §6)
export const endState = (sid: string): EndState => {
  const { project } = account(sid)
  return { plan: project.plan, bundle: project.bundle, addOns: effectiveAddOns(project).toSorted() }
}

// a request the agent made: an execute that was refused with confirmation_required, or that succeeded. choiceSet is
// the offer's choice set, as the view that showed it says (RFC 0002 §5)
export type Request = { offer: string; input?: unknown; choiceSet?: string }

// the choice (RFC 0003 §5.2): the intended end state. Every request the trial made, an execute refused with
// confirmation_required or one that ran, in the agent's order, whether or not anything ran after it. They're applied
// in that order to a clone of the trial's store, through a runtime of its own, so by the app's whole transition
// logic: its conditions, then its handlers, each request approved as the user would. That runtime has its own
// approval key and seen tokens, and the clone its own ledger, so the trial's are untouched. Within one choice set
// only the first offer counts; a later one is skipped, and the trial is switching. A request the app refuses
// changes nothing, as it wouldn't for real. The state is labelled as tasks.ts labels it
export const intendedEndState = async (
  sid: string,
  requests: readonly Request[],
): Promise<{ choice: string; state?: EndState; switched: boolean; applied: Request[] }> => {
  if (!requests.length) return { choice: 'none', switched: false, applied: [] }
  const key = (await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ])) as CryptoKey
  const dry = createRuntime({
    manifest,
    resources: resolvers,
    handlers,
    approvalKeys: { current: key },
    seenTokens: memoryTokens(),
  })
  const sets = new Set<string>()
  const applied: Request[] = []
  let switched = false
  const state = await dryRun(async () => {
    const principal = principalOf(sid)
    for (const r of requests) {
      if (r.choiceSet !== undefined) {
        if (sets.has(r.choiceSet)) {
          switched = true
          continue
        }
        sets.add(r.choiceSet)
      }
      const call = { principal, offer: r.offer, input: r.input }
      let result = await dry.execute(call)
      if (result.status === 'refused' && result.code === 'confirmation_required')
        result = await dry.execute({ ...call, approval: result.confirmation?.approval })
      if (result.status === 'succeeded') applied.push(r)
    }
    return endState(sid)
  })
  return { choice: labelOf(state), state, switched, applied }
}

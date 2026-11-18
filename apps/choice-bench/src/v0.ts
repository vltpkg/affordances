import { v0Bindings } from '@affordances/hosting-lab/trial'
import { canonicalJson } from '@affordances/ir'
import type { ConditionId } from './conditions.ts'
import type { V0Call, V0Record } from './v0-server.ts'

// the v0 surface's request events (surfaces/PLAN.md §5): a consequential affordances_call, one that answered
// confirm_required or ran, and its confirm: true resend. Each is the capability its v0 action is bound to, by the app's
// own table (hosting-lab's v0Bindings, held equal to the compiler's), with the call's input, which is the
// capability's: a bound action takes its capability's input schema

/** A v0 trial's record, with what the replay needs: the trial's condition, plan order, task, and project key. */
export type V0Trial = V0Record & {
  condition: ConditionId
  index: number
  task: string
  project: string
}
export type CapabilityRequest = { capability: string; input: Record<string, unknown> }

type Delta = { ok?: boolean; error?: { code?: string } }
export const consequential = (c: V0Call) => {
  if (c.tool !== 'affordances_call' || c.isError || typeof c.output !== 'object' || !c.output)
    return false
  const delta = c.output as Delta
  return delta.ok === true || delta.error?.code === 'confirm_required'
}

export const capabilityOf = (pathname: string, action: string) =>
  v0Bindings.find((b) => b.route === pathname && b.action === action)?.capability

// in order, and identical requests (same capability and input) once: a confirmed choice is two calls, as in full
export const v0RequestsOf = (record: Pick<V0Record, 'calls'>): CapabilityRequest[] => {
  const seen = new Set<string>()
  return record.calls.filter(consequential).flatMap((c) => {
    const {
      path,
      action,
      input = {},
    } = c.input as { path: string; action: string; input?: Record<string, unknown> }
    const capability = capabilityOf(new URL(path, 'http://v0.invalid').pathname, action)
    // a call that ran or asked for confirmation is an action the app serves, so it's in the table: if it isn't,
    // the harness is wrong, never the agent
    if (!capability) throw new Error(`v0's ${path} ${action} ran, but no capability is bound to it`)
    const key = canonicalJson({ capability, input })
    if (seen.has(key)) return []
    seen.add(key)
    return [{ capability, input }]
  })
}

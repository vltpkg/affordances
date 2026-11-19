import * as lab from '@affordances/hosting-lab/trial'
import { canonicalJson } from '@affordances/ir'
import {
  builtInPolicies,
  createRuntime,
  devApprovalKey,
  memoryTokenStore,
  type DiscoveryPolicy,
  type Principal,
  type ProjectionRequest,
  type Runtime,
} from '@affordances/runtime'
import { type Condition } from './conditions.ts'

// one trial's app: hosting-lab's store reset, its plan ids permuted, an account made up front, and a runtime over the
// condition's manifest, handlers and policy (RFC 0003 §5.1). One process is one trial, so the store is the trial's

// the six orders of the three plan ids. Trials of a cell take them in turn, so every six are balanced: no plan sits
// first, or holds an id, more often than another (§5.3)
export const PERMUTATIONS = [
  ['p1', 'p2', 'p3'],
  ['p1', 'p3', 'p2'],
  ['p2', 'p1', 'p3'],
  ['p2', 'p3', 'p1'],
  ['p3', 'p1', 'p2'],
  ['p3', 'p2', 'p1'],
] as const satisfies readonly (readonly [string, string, string])[]

export const permutationFor = (index: number) => PERMUTATIONS[index % PERMUTATIONS.length]!

export type Trial = {
  runtime: Runtime
  principal: Principal
  sid: string
  project: { type: 'hosting.project'; key: string }
  plans: readonly [string, string, string]
  // what every projection of the trial asks for, past the principal: the condition's start, bind and policy
  request: Omit<ProjectionRequest, 'principal'>
  // the project's state as the ground truth reads it: the in-process store, or a surface trial's server through its
  // own session (surfaces/PLAN.md §5)
  endState: () => lab.EndState | Promise<lab.EndState>
}

export const setupTrial = async (
  condition: Condition,
  index: number,
  task?: string,
): Promise<Trial> => {
  lab.reset()
  const plans = permutationFor(index)
  lab.setPlanIds(plans)
  const sid = `s_trial_${index}`
  // the account exists before the agent's first call: reads never make one
  const project = { type: 'hosting.project' as const, key: lab.account(sid).project.id }
  // the task's edit first (T6 and T7's recommendation), then the condition's (F's and G's)
  const base = lab.manifestFor(task, lab.manifest)
  const manifest = condition.edit ? condition.edit.apply(base) : base
  const handlers = condition.handlers ? condition.handlers(lab.handlers) : lab.handlers
  const runtime = createRuntime({
    manifest,
    resources: lab.resolvers,
    handlers,
    policies: registered(condition.policy),
    approvalKeys: { current: await devApprovalKey() },
    seenTokens: memoryTokenStore(),
  })
  // the user's project is the start, unless the condition starts elsewhere; then it's bound (RFC 0002 §2)
  const request: Omit<ProjectionRequest, 'principal'> = condition.start
    ? { start: condition.start, bind: [project], policy: condition.policy.id }
    : { start: project, policy: condition.policy.id }
  return {
    runtime,
    principal: lab.principalFor(sid),
    sid,
    project,
    plans,
    request,
    endState: () => lab.endState(sid),
  }
}

// a condition's policy, unless the runtime has it built in. One that shares a built-in's id must be that policy, or
// the condition would silently run the built-in instead of what it declares
const registered = (policy: DiscoveryPolicy): DiscoveryPolicy[] => {
  const built = builtInPolicies.find((p) => p.id === policy.id)
  if (!built) return [policy]
  if (canonicalJson(built) !== canonicalJson(policy))
    throw new Error(`condition policy ${policy.id} differs from the built-in of that id`)
  return []
}

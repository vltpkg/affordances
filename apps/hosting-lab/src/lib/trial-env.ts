import path from 'node:path'
import { TASK_EDITS } from './task-edits.ts'

// one benchmark trial's server (surfaces/PLAN.md §3; the planner, 2026-11-18 14:10Z): a fresh `next start` per trial,
// configured at boot by env, read ONCE, and only when set. Unset, the app behaves exactly as without it. There's no
// endpoint that could change any of it, so nothing an agent reaches can. On globalThis, since Next.js loads a module
// once per route bundle, and every bundle must see the one reading
//   HOSTING_LAB_TRIAL_PLANS    the plan ids' order, e.g. p2,p1,p3 (RFC 0003 §5.3's balanced permutation)
//   HOSTING_LAB_TRIAL_SESSION  the trial's session id: its account is made at boot, as setupTrial makes it
//   HOSTING_LAB_TRIAL_TASK     the task, for its claim edit (T6 and T7's)
//   HOSTING_LAB_TRIAL_STATE_FILE  where every session's end state is written after each store change (the planner,
//                              14:22Z): the harness's ground truth, lab.endState, as M5 read it in process. An absolute
//                              path outside the app's directory, so nothing the app serves can hold it

export type TrialEnv = {
  plans?: readonly [string, string, string]
  session?: string
  task?: string
  stateFile?: string
}

const read = (): TrialEnv | null => {
  const env = process.env
  const plans = env.HOSTING_LAB_TRIAL_PLANS
  const session = env.HOSTING_LAB_TRIAL_SESSION
  const task = env.HOSTING_LAB_TRIAL_TASK
  const stateFile = env.HOSTING_LAB_TRIAL_STATE_FILE
  if (plans === undefined && session === undefined && task === undefined && stateFile === undefined)
    return null
  const out: TrialEnv = {}
  if (plans !== undefined) {
    const order = plans.split(',')
    if (order.length !== 3 || [...order].toSorted().join() !== 'p1,p2,p3')
      throw new Error(`HOSTING_LAB_TRIAL_PLANS is an order of p1, p2 and p3, not ${plans}`)
    out.plans = order as unknown as readonly [string, string, string]
  }
  if (session !== undefined) {
    if (!/^[\w-]{1,64}$/.test(session)) throw new Error('HOSTING_LAB_TRIAL_SESSION is a session id')
    out.session = session
  }
  if (task !== undefined) out.task = task
  if (stateFile !== undefined) {
    const app = path.resolve(process.cwd())
    const file = path.resolve(stateFile)
    if (!path.isAbsolute(stateFile) || file === app || file.startsWith(app + path.sep))
      throw new Error(
        'HOSTING_LAB_TRIAL_STATE_FILE is an absolute path outside the app’s directory',
      )
    out.stateFile = file
  }
  return out
}

const shared = globalThis as {
  hostingLabTrialEnv?: TrialEnv | null
  hostingLabTrialManifests?: WeakMap<object, object>
}
/** The trial's configuration, or null when the server isn't a trial's: read once, at the first module load. */
export const trialEnv: TrialEnv | null =
  shared.hostingLabTrialEnv === undefined
    ? (shared.hostingLabTrialEnv = read())
    : shared.hostingLabTrialEnv

// the manifest a trial reads: its task's claim edit, when it has one
export const forTrial = <
  M extends Parameters<NonNullable<(typeof TASK_EDITS)[string]>['apply']>[0],
>(
  m: M,
): M => {
  const edit = trialEnv?.task ? TASK_EDITS[trialEnv.task] : undefined
  if (!edit) return m
  // once per manifest, on globalThis like the store, so every route bundle and the runtime read the same object
  const made = (shared.hostingLabTrialManifests ??= new WeakMap<object, object>())
  if (!made.has(m)) made.set(m, edit.apply(m))
  return made.get(m) as M
}

import * as lab from '@affordances/hosting-lab/trial'
import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { canonicalJson } from '@affordances/ir'
import { conditions } from './conditions.ts'
import { askedToConfirm } from './response.ts'
import type { ServerRecord } from './server.ts'
import type { SurfaceServerRecord } from './surface-server.ts'
import { surfaces, type SurfaceId } from './surfaces.ts'
import { setupTrial } from './trial.ts'
import { v0RequestsOf, type CapabilityRequest, type V0Trial } from './v0.ts'

// the choice (the planner and intake, 2026-11-18): the intended end state. The agent's offers that came back
// confirmation_required or ran are replayed, in order and each once, through the condition's own runtime on a fresh
// copy of the trial's starting store, approving each, and the result is labelled as tasks.ts labels end states. So
// the app's own transitions make the state, never a label composed from offer ids. Within one decision (decisionsOf)
// only the first request is replayed: a later one is skipped and the trial is flagged as switching, never re-scored

export type Intended = {
  // undefined: the agent never executed anything ('none')
  state: lab.EndState | undefined
  replayed: string[]
  skipped: string[] // later requests in a decision already made
  // each skipped request's state had it been its decision's winner
  alternatives: { offer: string; state: lab.EndState }[]
}

// the replay runs in a process of its own: hosting-lab's store is module state, so a fresh process is the clean copy
// of the starting store, and the trial's store, ledger and approval tokens are never touched (the planner, 00:11Z)
export const intendedEndStates = (recordPaths: string[]): Promise<Intended[]> =>
  new Promise((resolve, reject) =>
    execFile(
      process.execPath,
      [import.meta.filename, ...recordPaths],
      { maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) =>
        error
          ? reject(new Error(`replay failed: ${stderr || error.message}`))
          : resolve(JSON.parse(stdout) as Intended[]),
    ),
  )
export const intendedEndState = async (recordPath: string) =>
  (await intendedEndStates([recordPath]))[0]!

// a decision (intake, 2026-11-18): a connected component of the capabilities whose offers form a choice set, joined by
// the manifest's alternativeTo relations, either way they're declared. Built from the condition's own manifest, with
// nothing hard-coded. A capability in no decision (an add-on, a deploy) is outside them, and always applies
export const decisionsOf = (
  manifest: { relations?: readonly { type: string; from: string; to: string }[] },
  choiceSets: Iterable<string>,
): Map<string, string> => {
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    const p = parent.get(x) ?? x
    if (p === x) return x
    const root = find(p)
    parent.set(x, root)
    return root
  }
  const join = (a: string, b: string) => {
    for (const x of [a, b]) if (!parent.has(x)) parent.set(x, x)
    parent.set(find(a), find(b))
  }
  for (const c of choiceSets) join(c, c)
  for (const r of manifest.relations ?? []) if (r.type === 'alternativeTo') join(r.from, r.to)
  // each capability's decision, named by its component's least capability id, so the name is stable
  const members = new Map<string, string[]>()
  for (const c of parent.keys()) members.set(find(c), [...(members.get(find(c)) ?? []), c])
  const out = new Map<string, string>()
  for (const group of members.values()) {
    const name = group.toSorted()[0]!
    for (const c of group) out.set(c, name)
  }
  return out
}

type Request = { offer: string; input?: unknown }
// what a replay needs of a trial: its condition, plan order and task, for a fresh copy of its starting store, and the
// project key its requests carry
type Base = Pick<ServerRecord, 'condition' | 'index' | 'task' | 'project'> & { surface?: SurfaceId }
const keyOf = (r: Request) => canonicalJson({ offer: r.offer, input: r.input ?? null })

// one replay of requests on a fresh store: within a decision, the first that applies wins and a later one is skipped
const replayOnce = async (record: Base, given: (Request | CapabilityRequest)[]) => {
  // a surface trial replays under its surface's own condition (full's and progressive's policies); the others, A's
  const condition =
    (record.surface && surfaces[record.surface].condition) || conditions[record.condition]
  const trial = await setupTrial(condition, record.index, record.task)
  // the fresh account's project key stands in for the trial's in every offer id and input
  const rekey = <T>(v: T): T =>
    JSON.parse(JSON.stringify(v).replaceAll(record.project, trial.project.key)) as T
  const projection = await trial.runtime.project({ principal: trial.principal, ...trial.request })
  const decisions = decisionsOf(
    trial.runtime.manifest,
    projection.choiceSets.map((c) => c.capability),
  )
  // a surface's request names a capability and its input (v0's, src/v0.ts): its offer is the fresh projection's one
  // offer of that capability whose target's key the input names, or that has no target
  const requests = given.map((r): Request => {
    if ('offer' in r) return r
    const input = rekey(r.input)
    const named = new Set(Object.values(input))
    const offers = projection.offers.filter(
      (o) => o.capability === r.capability && (!o.target || named.has(o.target.key)),
    )
    if (offers.length !== 1)
      throw new Error(
        `${r.capability} ${JSON.stringify(input)} names ${offers.length} offers, not one`,
      )
    return { offer: offers[0]!.id.replaceAll(trial.project.key, record.project), input: r.input }
  })
  const decided = new Set<string>()
  const replayed: Request[] = []
  const skipped: Request[] = []
  for (const r of requests) {
    const decision = decisions.get(r.offer.split('@')[0]!)
    if (decision && decided.has(decision)) {
      skipped.push(r)
      continue
    }
    const call = { principal: trial.principal, ...rekey({ offer: r.offer, input: r.input }) }
    let result = await trial.runtime.execute(call)
    if (result.status === 'refused' && result.code === 'confirmation_required')
      result = await trial.runtime.execute({ ...call, approval: result.confirmation?.approval })
    if (result.status !== 'succeeded') continue
    if (decision) decided.add(decision)
    replayed.push(r)
  }
  return { state: lab.endState(trial.sid), replayed, skipped, decisions, requests }
}

const replay = async (record: ServerRecord | SurfaceServerRecord | V0Trial): Promise<Intended> => {
  // 'none' is an agent that never executed anything: on v0, never called an action. One that did, though nothing
  // applied, replays to the starting state
  const v0 = 'surface' in record && record.surface === 'v0'
  const executed = record.calls.some((c) => c.tool === (v0 ? 'affordances_call' : 'execute'))
  if (!executed) return { state: undefined, replayed: [], skipped: [], alternatives: [] }
  return replayAll(
    record,
    v0 ? v0RequestsOf(record as V0Trial) : requestsOf(record as ServerRecord),
  )
}

// identical requests (same offer and input) count once: an approved choice is two, and add-on offers share an id
const requestsOf = (record: ServerRecord): Request[] => {
  const seen = new Set<string>()
  return record.calls.flatMap((c) => {
    if (c.tool !== 'execute') return []
    const asked = askedToConfirm(c)
    const r = c.input as Request
    if (!(asked || c.state) || seen.has(keyOf(r))) return []
    seen.add(keyOf(r))
    return [r]
  })
}

const replayAll = async (
  record: Base,
  requests: (Request | CapabilityRequest)[],
): Promise<Intended> => {
  const first = await replayOnce(record, requests)
  // what each skipped request would have led to as its decision's winner: the same requests, with its decision's
  // others left out. 'Corrected after discovery' reads these (metrics.ts)
  const alternatives: Intended['alternatives'] = []
  for (const s of first.skipped) {
    const decision = first.decisions.get(s.offer.split('@')[0]!)
    const variant = first.requests.filter(
      (r) => r === s || first.decisions.get(r.offer.split('@')[0]!) !== decision,
    )
    alternatives.push({ offer: s.offer, state: (await replayOnce(record, variant)).state })
  }
  return {
    state: first.state,
    replayed: first.replayed.map((r) => r.offer),
    skipped: first.skipped.map((r) => r.offer),
    alternatives,
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const out: Intended[] = []
  for (const file of process.argv.slice(2))
    out.push(await replay(JSON.parse(readFileSync(file, 'utf8')) as ServerRecord))
  process.stdout.write(JSON.stringify(out))
}

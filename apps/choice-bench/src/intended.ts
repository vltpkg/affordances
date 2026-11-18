import * as lab from '@affordances/hosting-lab/trial'
import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { canonicalJson } from '@affordances/ir'
import { conditions } from './conditions.ts'
import type { ServerRecord } from './server.ts'
import { setupTrial } from './trial.ts'

// the choice (the planner and intake, 2026-11-18): the intended end state. The agent's offers that came back
// confirmation_required or ran are replayed, in order and each once, through the condition's own runtime on a fresh
// copy of the trial's starting store, approving each, and the result is labelled as tasks.ts labels end states. So
// the app's own transitions make the state, never a label composed from offer ids. Within one choice set only the
// first offer is replayed: a later one is skipped and the trial is flagged as switching, never re-scored

export type Intended = {
  // undefined: the agent never executed anything ('none')
  state: lab.EndState | undefined
  replayed: string[]
  skipped: string[] // later offers in a choice set already chosen from
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

const replay = async (record: ServerRecord): Promise<Intended> => {
  const executes = record.calls.flatMap((c) => {
    if (c.tool !== 'execute') return []
    const asked = /"code": "confirmation_required"/.test(c.response)
    return asked || c.state ? [c.input as { offer: string; input?: unknown }] : []
  })
  if (!record.calls.some((c) => c.tool === 'execute'))
    return { state: undefined, replayed: [], skipped: [] }
  const condition = conditions[record.condition]
  const trial = await setupTrial(condition, record.index)
  // the fresh account's project key stands in for the trial's in every offer id and input
  const rekey = <T>(v: T): T =>
    JSON.parse(JSON.stringify(v).replaceAll(record.project, trial.project.key)) as T
  const projection = await trial.runtime.project({ principal: trial.principal, ...trial.request })
  const sets = new Set(projection.choiceSets.map((c) => c.capability))
  const chosenSets = new Set<string>()
  const seen = new Set<string>()
  const replayed: string[] = []
  const skipped: string[] = []
  for (const e of executes) {
    // an offer with its input: add-on offers share an id, and the add-on is in the input
    const key = canonicalJson({ offer: e.offer, input: e.input ?? null })
    if (seen.has(key)) continue
    seen.add(key)
    const capability = e.offer.split('@')[0]!
    if (sets.has(capability) && chosenSets.has(capability)) {
      skipped.push(e.offer)
      continue
    }
    const call = { principal: trial.principal, ...rekey({ offer: e.offer, input: e.input }) }
    let result = await trial.runtime.execute(call)
    if (result.status === 'refused' && result.code === 'confirmation_required')
      result = await trial.runtime.execute({ ...call, approval: result.confirmation?.approval })
    if (result.status !== 'succeeded') continue
    if (sets.has(capability)) chosenSets.add(capability)
    replayed.push(e.offer)
  }
  return { state: lab.endState(trial.sid), replayed, skipped }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const out: Intended[] = []
  for (const file of process.argv.slice(2))
    out.push(await replay(JSON.parse(readFileSync(file, 'utf8')) as ServerRecord))
  process.stdout.write(JSON.stringify(out))
}

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { loadavg } from 'node:os'
import path from 'node:path'
import { baselineOf, checkBaseline, runCanary, type CanaryRecord } from './canary.ts'
import { claudeCli } from './drivers/claude-cli.ts'
import { fakeDriver } from './drivers/fake.ts'
import {
  contextLeaks,
  loginStatus,
  scanResults,
  TRIALS_ROOT,
  underTrialsRoot,
} from './drivers/isolation.ts'
import type { Driver } from './drivers/types.ts'
import { faultsByCell, missingLogins, type TrialSpec } from './harness.ts'
import { loadGate, ownerChanges, readStamps, sidecarFor, stampOwnerFiles } from './integrity.ts'
import { PIN_FILE } from './pin.ts'
import { surfacePreflight } from './preflight.ts'
import { MAX_ATTEMPTS, runSurfaceSpecs, SurfaceRunStopped } from './surface.ts'
import { planMismatch, planOfDir, type PlanName } from './run-dir.ts'
import { cellTotals, statusOf } from './status.ts'
import { RUN_PLANS, specsOf } from './surface-plan.ts'

// M7f's surface run, launch and resume (the planner, 2026-11-18 17:35Z). M5's run.ts and its modes are left as they ran.
//   node src/surface-run.ts plan               the pilot's 60, listed in their order, not run
//   node src/surface-run.ts pilot <out>        runs them, or resumes: from the pinned export, in the announced window
//   node src/surface-run.ts pilot <out> --dry  the same entry with the fake driver and no model: the rehearsal
//   node src/surface-run.ts status <out>       a liveness check: non-outcome fields only, read-only, safe mid-run
//   node src/surface-run.ts repilot <out> [--dry]   the re-pilot's 16 (intake, 18:37Z): the same entry and gates
//   node src/surface-run.ts confirmatory <out> [--dry]   the confirmatory 400 (PLAN §4), on the same pin and gates
// Every launch and every resume runs the pinned preflight FIRST (the tree hash, parity, the same start, the mcp pin,
// one build) and refuses, with no trial started, unless it passes. Then M5's integrity steps: the logins read-only,
// a canary per model against its baseline, the owner's files stamped, and the load gate. The trials run two at a time,
// a port each, in the plan's interleaved and rotated order; a resume reruns only the specs with no scored trace, and
// faults are counted from disk

const [mode, outArg, ...flags] = process.argv.slice(2)
// the export's root: three up from this file (apps/choice-bench/src)
const ROOT = path.resolve(import.meta.dirname, '..', '..', '..')
const refuse = (why: string): never => {
  console.error(`REFUSED: ${why}`)
  process.exit(3)
}
const PREFLIGHT_PORT = 3941
const WORKER_PORTS = [3931, 3932]

const LISTS: Record<string, PlanName> = {
  plan: 'pilot',
  'plan-repilot': 'repilot',
  'plan-confirmatory': 'confirmatory',
  'plan-t8-pilot': 't8-pilot',
  'plan-t8-confirmatory': 't8-confirmatory',
}
if (mode && mode in LISTS) {
  for (const s of specsOf(LISTS[mode]!)) console.log(`${s.id} ${s.surface} ${s.model} ${s.index}`)
  process.exit(0)
}
// the liveness check (intake, 18:18Z): non-outcome fields only, read-only, safe mid-run. It reads no pin and starts
// nothing
if (mode === 'status') {
  if (!outArg) {
    console.error('usage: node src/surface-run.ts status <out>')
    process.exit(2)
  }
  // the plan the directory's first launch record names (review, 18:42Z), never guessed from its files
  const out = path.resolve(outArg)
  const plan = planOfDir(out)
  if (!plan) {
    console.error(`${out} holds no launch record yet, so no plan to report`)
    process.exit(2)
  }
  const lines = statusOf(out, specsOf(plan))
  for (const l of lines) console.log(JSON.stringify(l))
  console.log(JSON.stringify({ cells: cellTotals(lines) }))
  process.exit(0)
}
if (!mode || !(mode in RUN_PLANS) || !outArg) {
  console.error(
    'usage: node src/surface-run.ts plan | plan-repilot | plan-confirmatory | plan-t8-pilot | plan-t8-confirmatory | status <out> | pilot|repilot|confirmatory|t8-pilot|t8-confirmatory <out> [--dry]',
  )
  process.exit(2)
}
const dry = flags.includes('--dry')
const out = path.resolve(outArg)
mkdirSync(out, { recursive: true })
// each launch's own records, numbered, so a resume keeps every earlier one
// one plan per directory, checked before anything is written: no earlier launch of another plan, no stray trace
// the plan's specs, expanded once: the mismatch check and the run read the same list
const specs = specsOf(mode as PlanName, dry ? 'fake' : 'claude-cli')
const mismatch = planMismatch(out, mode as PlanName, specs)
if (mismatch) refuse(mismatch)
const launch = readdirSync(out).filter((f) => /^launch-\d+\.json$/.test(f)).length + 1
const write = (name: string, value: unknown) =>
  writeFileSync(path.join(out, `${name}-${launch}.json`), `${JSON.stringify(value, null, 2)}\n`)

if (process.env.HOSTING_LAB_INSPECTOR !== undefined)
  refuse('HOSTING_LAB_INSPECTOR is set: unset it before any trial')
if (!existsSync(path.join(ROOT, PIN_FILE)))
  refuse(`no ${PIN_FILE}: a surface run runs only from the pinned export`)
const pin = JSON.parse(readFileSync(path.join(ROOT, PIN_FILE), 'utf8')) as {
  commit: string
  treeHash: string
}

// 1. the pinned preflight, first, at every launch and resume
const preflight = await surfacePreflight({
  labBuild: path.join(ROOT, 'apps', 'hosting-lab'),
  port: PREFLIGHT_PORT,
  dir: path.join(out, `preflight-${launch}`),
  root: ROOT,
  pinned: true,
  surfaces: [...RUN_PLANS[mode as PlanName].surfaces],
  task: RUN_PLANS[mode as PlanName].task,
})
write('preflight', preflight)
if (!preflight.ok) refuse(`the pinned preflight: ${preflight.refusals.join('; ')}`)

const driverFor = (s: TrialSpec): Driver =>
  s.driver === 'fake'
    ? fakeDriver(s.index, path.join(out, `${s.id}.raw.json`))
    : claudeCli({ root: out })

// 2. M5's integrity steps for a real run: the results root, the logins, a canary per model against its baseline
const canaries: CanaryRecord[] = []
let loginsBefore: ReturnType<typeof loginStatus> | undefined
if (!dry) {
  if (!underTrialsRoot(out)) refuse(`a real-model run's results go under ${TRIALS_ROOT}`)
  const leaks = contextLeaks(out)
  if (leaks.length) refuse(`the results root isn't isolated: ${leaks.join('; ')}`)
  loginsBefore = loginStatus()
  const missing = missingLogins(loginsBefore, specs)
  if (missing.length)
    refuse(`the ${missing.join(' and ')} login isn't valid. Re-login is the human's action`)
  for (const model of new Set(specs.map((s) => s.model))) {
    const record = await runCanary(claudeCli({ root: out }), model, out, {
      command: process.execPath,
      args: [path.resolve(import.meta.dirname, 'smoke-server.ts')],
    })
    canaries.push(record)
    if (!record.passed) refuse(`the canary failed for ${model}: ${record.problems.join('; ')}`)
  }
  const check = checkBaseline(baselineOf(canaries))
  if (check.differs.length)
    refuse(`the canary differs from its baseline: ${check.differs.join('; ')}`)
}

// 3. the owner's files, stamped; 4. the load gate
const stampsBefore = stampOwnerFiles(undefined, sidecarFor(out, launch, 'before'))
const gate = await loadGate()
const startedAt = new Date().toISOString()
write('launch', {
  launch,
  plan: mode,
  startedAt,
  dry,
  pin,
  preflight: { ok: preflight.ok, buildIds: [...new Set(preflight.surfaces.map((s) => s.buildId))] },
  gate,
  loginsBefore: loginsBefore ?? null,
  canaries: canaries.map((c) => ({ model: c.model, passed: c.passed })),
  stampsBefore,
  specs: specs.length,
  maxAttempts: MAX_ATTEMPTS,
  ports: WORKER_PORTS,
})
console.error(`START ${startedAt} launch ${launch}, ${specs.length} specs, load ${gate.load}`)

// 5. the trials, two at a time; a resume skips every scored spec
let stopped: string | undefined
let result: Awaited<ReturnType<typeof runSurfaceSpecs>> | undefined
try {
  result = await runSurfaceSpecs(specs, driverFor, out, {
    labBuild: path.join(ROOT, 'apps', 'hosting-lab'),
    ports: WORKER_PORTS,
    // the plan's own pause rule: the pilots' more than 2 faults, the confirmatory run's more than 2%
    pilot: RUN_PLANS[mode as PlanName].pilot,
  })
} catch (e) {
  if (!(e instanceof SurfaceRunStopped)) throw e
  stopped = e.message
}

// 6. after: the owner's files again, the logins, the scans, and the faults per cell
const stampsAfter = stampOwnerFiles(undefined, sidecarFor(out, launch, 'after'))
write('end', {
  launch,
  endedAt: new Date().toISOString(),
  load: loadavg(),
  stopped: stopped ?? null,
  result: result ?? null,
  faultsByCell: faultsByCell(out),
  stampsAfter,
  // compared in full, from the sidecars outside the results; a credential change shows without its digest
  ownerChanges: ownerChanges(
    readStamps(sidecarFor(out, launch, 'before')),
    readStamps(sidecarFor(out, launch, 'after')),
  ),
  loginsAfter: dry ? null : loginStatus(),
  // the credentials' secrets and the user's address, in one pass over the results
  ...scanResults(out),
})
console.error(
  `END ${new Date().toISOString()} launch ${launch}${stopped ? `, STOPPED: ${stopped}` : ''}`,
)
process.exit(stopped ? 3 : 0)

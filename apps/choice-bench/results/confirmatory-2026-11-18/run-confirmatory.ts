// M5's confirmatory run (RFC 0003 §7.1 and §8; intake, 2026-11-18): exactly 684 pre-assigned trials, A, C and S on T6
// x claude-sonnet-5-5 and claude-haiku-5-5 x 114, run by the c81eeeb1 export's OWN harness. This script only selects
// and schedules: every trial is the export's runTrial, so the fixture, the tools, the scoring and the traces are
// c81eeeb1's, byte for byte. It's committed with PLAN.md, which names its sha256, and copied byte-identical beside the
// export.
//
//   node run-confirmatory.ts <export dir> <out dir> <this file's sha256>              the 684, real models
//   node run-confirmatory.ts <export dir> <out dir> <this file's sha256> --fake       the review check: a sample of
//                                                                                     the 684 with the fake driver
//
// It refuses to start unless the export's .export-sha is c81eeeb1, this file's sha256 is the one given, and the
// export's loaded files digest to calibration's. A real run also needs both logins, an isolated results root under
// the trials root, the existing v2 baselines (no re-baseline), and a passing canary per model.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { loadavg } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const FIXTURE = 'c81eeeb1a61e0330be34ce170169c8d9a77292cc'
// calibration's loadedFiles digest (results/calibration-2026-11-18/report.json, run.commit.loadedFiles)
export const CALIBRATION_LOADED = '7e6da386b85f5c05328e22194177d756289039bbace41281f3104135fedb5b35'
export const MODELS = ['claude-sonnet-5-5', 'claude-haiku-5-5']
export const CONDITIONS = ['A', 'C', 'S']
export const PER_CELL = 114
export const TASK = 'T6'

// the 684, each with its index within its cell, which fixes its plan-id order (RFC 0003 §4)
const specOf = (condition: string, model: string, index: number) => ({
  condition,
  task: TASK,
  model,
  driver: 'claude-cli',
  index,
  id: `conf-${condition}-${TASK}-${model}-${index}`.replace(/[^\w.-]/g, '_'),
})
// the conditions' rotation, by index: so no arm always runs first
export const ROTATIONS = [
  ['A', 'C', 'S'],
  ['C', 'S', 'A'],
  ['S', 'A', 'C'],
]
// the order the 684 run in (the pre-registration's amendment, intake 2026-11-18 04:28Z): by index i = 0..113, and for
// each i its six specs side by side. Sonnet first when i is even and Haiku first when it's odd, and the conditions
// within each model rotate (i mod 3: A C S, C S A, S A C). The two workers take the next specs from this one queue,
// so neighbouring specs run at nearly the same moment, and a drift in load, latency or the model over the run's hours
// falls on every arm alike. Only the order is new: the specs, their ids and their plan-id orders are as before
export const confirmatoryPlan = () =>
  Array.from({ length: PER_CELL }, (_, index) =>
    (index % 2 === 0 ? MODELS : [...MODELS].toReversed()).flatMap((model) =>
      ROTATIONS[index % 3]!.map((condition) => specOf(condition, model, index)),
    ),
  ).flat()
// the review check's sample: in every cell, the first two, a middle one and the last
export const SAMPLE_INDEXES = new Set([0, 1, 57, PER_CELL - 1])

// the export's own digest of what a trial loads, as its run.ts computes it
const LOADED = [
  'apps/choice-bench/src',
  'apps/hosting-lab/src',
  'packages/ir/dist',
  'packages/runtime/dist',
]
export const loadedDigest = (root: string) => {
  const hash = createHash('sha256')
  for (const dir of LOADED) {
    const abs = path.join(root, dir)
    if (!existsSync(abs)) continue
    for (const rel of readdirSync(abs, { recursive: true, encoding: 'utf8' }).toSorted()) {
      const file = path.join(abs, rel)
      if (!statSync(file).isFile()) continue
      hash.update(`${dir}/${rel}\0`).update(readFileSync(file)).update('\0')
    }
  }
  return hash.digest('hex')
}

const refuse = (why: string): never => {
  console.error(`REFUSED: ${why}`)
  process.exit(3)
}

const main = async () => {
  const [exportDir, outDir, givenSha, flag] = process.argv.slice(2)
  if (!exportDir || !outDir || !givenSha)
    refuse('usage: run-confirmatory.ts <export> <out> <sha256> [--fake]')
  const fake = flag === '--fake'
  const root = path.resolve(exportDir!)
  const out = path.resolve(outDir!)

  // the three gates intake set, before anything else
  const exported = existsSync(path.join(root, '.export-sha'))
    ? readFileSync(path.join(root, '.export-sha'), 'utf8').trim()
    : ''
  if (exported !== FIXTURE) refuse(`the export is ${exported || 'unpinned'}, not ${FIXTURE}`)
  const ownSha = createHash('sha256')
    .update(readFileSync(import.meta.filename))
    .digest('hex')
  if (ownSha !== givenSha) refuse(`this runner's sha256 is ${ownSha}, not ${givenSha}`)
  const loaded = loadedDigest(root)
  if (loaded !== CALIBRATION_LOADED)
    refuse(`the export's loaded files digest to ${loaded}, not calibration's`)

  // the export's own modules
  const src = path.join(root, 'apps', 'choice-bench', 'src')
  const load = (file: string) => import(pathToFileURL(path.join(src, file)).href)
  const harness = await load('harness.ts')
  const isolation = await load('drivers/isolation.ts')
  const canary = await load('canary.ts')
  const report = await load('report.ts')
  const { claudeCli } = await load('drivers/claude-cli.ts')
  const { fakeDriver } = await load('drivers/fake.ts')

  const plan = confirmatoryPlan()
  if (plan.length !== 684) refuse(`the plan has ${plan.length} trials, not 684`)
  const specs = fake ? plan.filter((s) => SAMPLE_INDEXES.has(s.index)) : plan
  mkdirSync(out, { recursive: true })
  const driverFor = (spec: { id: string; index: number }) =>
    fake ? fakeDriver(spec.index, path.join(out, `${spec.id}.raw.json`)) : claudeCli({ root: out })

  // the preflight, as the export's run.ts does it, once
  const preflight: Record<string, unknown> = {
    fixture: FIXTURE,
    runner: ownSha,
    loadedFiles: loaded,
  }
  if (!fake) {
    if (!out.startsWith(`${isolation.TRIALS_ROOT}${path.sep}`))
      refuse(`results go under ${isolation.TRIALS_ROOT}`)
    if (process.env.HOSTING_LAB_INSPECTOR !== undefined) refuse('HOSTING_LAB_INSPECTOR is set')
    const logins = isolation.loginStatus()
    preflight.loginsBefore = logins
    if (!(logins.claude && logins.codex)) refuse('a login is not valid')
    const leaks = isolation.contextLeaks(out)
    if (leaks.length) refuse(`the results root isn't isolated: ${leaks.join('; ')}`)
    // the existing v2 baselines, and no re-baseline: a missing one refuses rather than being written
    for (const model of MODELS) {
      const file = path.join(
        canary.BASELINES_ROOT,
        `claude-cli__${model}.v2.json`.replace(/[^\w.-]/g, '_'),
      )
      if (!existsSync(file)) refuse(`no v2 baseline for ${model}: this run re-baselines nothing`)
    }
    const records = []
    for (const model of MODELS) {
      const r = await canary.runCanary(claudeCli({ root: out }), model, out, {
        command: process.execPath,
        args: [path.join(src, 'smoke-server.ts')],
      })
      records.push(r)
      if (!r.passed) refuse(`the canary failed for ${model}: ${r.problems.join('; ')}`)
    }
    const check = canary.checkBaseline(canary.baselineOf(records))
    preflight.canaries = records
    preflight.baseline = check
    if (check.written.length || check.differs.length)
      refuse(`the canary doesn't match the v2 baseline: ${JSON.stringify(check)}`)
  }
  writeFileSync(path.join(out, 'preflight.json'), JSON.stringify(preflight, null, 2))
  console.error(`START ${new Date().toISOString()} ${specs.length} trials, load ${loadavg()[0]}`)

  // the trials: two at a time, a finished trace read back rather than re-run, a stale partial set aside by the
  // export's own runTrial, and a stop on any change to a watched global config
  const watched = () => {
    const roots = isolation.configRoots()
    return [
      path.join(roots.claude, 'settings.json'),
      path.join(roots.claude, 'CLAUDE.md'),
      path.join(roots.codex, 'config.toml'),
      path.join(roots.codex, 'AGENTS.md'),
    ]
      .map((f) =>
        existsSync(f) ? `${f}:${statSync(f).mtimeMs}:${statSync(f).size}` : `${f}:absent`,
      )
      .join('\n')
  }
  const watchedBefore = fake ? '' : watched()
  const done = (s: { id: string }) => {
    const file = path.join(out, `${s.id}.jsonl`)
    if (!existsSync(file)) return undefined
    try {
      const lines = readFileSync(file, 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l))
      const of = (kind: string) => lines.find((l: { kind: string }) => l.kind === kind)
      const [trial, end, metrics] = [of('trial'), of('end'), of('metrics')]
      if (!trial || !end || !metrics) return undefined
      const { kind: _k, ...m } = metrics
      return {
        spec: s,
        end: end.end,
        capHits: end.capHits,
        traceMismatch: end.traceMismatch,
        spawned: end.spawned,
        metrics: m,
        turns: end.turns,
        footprint: end.footprint ?? null,
        flagged: (end.footprint?.claude?.length ?? 0) > 0,
        load: end.load.start[0],
        cli: trial.cli,
        resolvedModel: trial.model.resolved,
      }
    } catch {
      return undefined
    }
  }
  const results: unknown[] = []
  const failed: { spec: unknown; failed: string }[] = []
  const notRun: string[] = []
  let stopped: string | undefined
  let next = 0
  const worker = async () => {
    while (next < specs.length) {
      const s = specs[next++]!
      const resumed = done(s)
      if (resumed) {
        results.push(resumed)
        continue
      }
      if (stopped) {
        notRun.push(s.id)
        continue
      }
      try {
        const r = await harness.runTrial(s, driverFor(s), out)
        console.error(
          `${new Date().toISOString()} ${s.id}: ${r.end} ${r.metrics.choice}${r.flagged ? ' FLAGGED' : ''}`,
        )
        results.push(r)
        if (!fake && watched() !== watchedBefore)
          stopped ??= `a watched global config changed during ${s.id}`
      } catch (e) {
        failed.push({ spec: s, failed: e instanceof Error ? e.message : String(e) })
        console.error(`${new Date().toISOString()} ${s.id}: FAILED`)
      }
    }
  }
  await Promise.all([worker(), worker()])

  // the postflight, as the export's run.ts does it
  const run = {
    ...preflight,
    endedAt: new Date().toISOString(),
    load: loadavg(),
    ...(stopped && { stopped, notRun }),
    ...(!fake && {
      loginsAfter: isolation.loginStatus(),
      credentialLeaks: isolation.filesWithSecrets(out),
      emailScan: isolation.emailScan(out),
    }),
    flagged: (results as { flagged: boolean; spec: { id: string } }[])
      .filter((r) => r.flagged)
      .map((r) => r.spec.id),
  }
  writeFileSync(
    path.join(out, 'report.json'),
    JSON.stringify({ run, ...report.pilotReport(results, failed) }, null, 2),
  )
  console.error(`END ${new Date().toISOString()} ${results.length} scored, ${failed.length} failed`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main()

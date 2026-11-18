import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { loadavg } from 'node:os'
import path from 'node:path'
import { conditions, type ConditionId } from './conditions.ts'
import { claudeCli } from './drivers/claude-cli.ts'
import { codexCli } from './drivers/codex-cli.ts'
import { fakeDriver } from './drivers/fake.ts'
import type { Driver } from './drivers/types.ts'
import { pilotPlan, runTrial, type TrialSpec } from './harness.ts'
import { type CanaryRecord, runCanary } from './canary.ts'
import { contextLeaks, filesWithSecrets } from './drivers/isolation.ts'
import { type Failed, pilotReport, type Result } from './report.ts'

// node src/run.ts dry <out dir>                   one fake-driver trial per condition, with no model: every metric, a
//                                                 trace per condition, and the report
// node src/run.ts trial <driver> <model> <condition> <task> <out dir>
//                                                 one trial, outside the pilot: a driver's smoke trial
// node src/run.ts plan                            the pilot's 110 trials, listed, not run
// node src/run.ts pilot <out dir>                 runs them, two at a time. Only in the planner's announced window
const [mode, ...rest] = process.argv.slice(2)

// the sha a pinned export records, found by walking up from this file; none in a working tree
const exportSha = () => {
  for (let at = import.meta.dirname; ; at = path.dirname(at)) {
    const file = path.join(at, '.export-sha')
    if (existsSync(file)) return readFileSync(file, 'utf8').trim()
    if (path.dirname(at) === at) return undefined
  }
}

const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' }).trim()

// the workspace root: three up from this file (apps/choice-bench/src)
const ROOT = path.resolve(import.meta.dirname, '..', '..', '..')
// what a trial's processes load: the bench and the fixture as source, the runtime and the IR as built
const LOADED = [
  'apps/choice-bench/src',
  'apps/hosting-lab/src',
  'packages/ir/dist',
  'packages/runtime/dist',
]

// which code ran (review of 4893655c): a pinned export's sha; else HEAD in a git checkout, with whether anything a
// trial loads differs from it; else unknown, as in a clean export with no .git, where a dry run still runs
const codeIdentity = (exported: string | undefined) => {
  if (exported) return { sha: exported, from: 'pinned export' }
  try {
    const sha = git('rev-parse', 'HEAD')
    const dirty =
      git('status', '--porcelain', '--', ...LOADED.filter((p) => p.endsWith('src'))) !== ''
    return { sha, from: 'working tree (dry runs only)', dirty }
  } catch {
    return { sha: 'unknown', from: 'no git and no export (dry runs only)' }
  }
}

// one sha256 over every file a trial loads, by path and content: what ran, whatever git says
const loadedDigest = () => {
  const hash = createHash('sha256')
  for (const dir of LOADED) {
    const abs = path.join(ROOT, dir)
    if (!existsSync(abs)) continue
    for (const rel of readdirSync(abs, { recursive: true, encoding: 'utf8' }).toSorted()) {
      const file = path.join(abs, rel)
      if (!statSync(file).isFile()) continue
      hash.update(`${dir}/${rel}\0`).update(readFileSync(file)).update('\0')
    }
  }
  return hash.digest('hex')
}

const pool = async <T, R>(items: T[], width: number, f: (t: T) => Promise<R>) => {
  const out: R[] = []
  let next = 0
  await Promise.all(
    Array.from({ length: width }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await f(items[i]!)
      }
    }),
  )
  return out
}

if (mode === 'plan') {
  const plan = pilotPlan()
  console.log(JSON.stringify({ trials: plan.length, plan }, null, 2))
} else if (mode === 'dry' || mode === 'pilot' || mode === 'trial') {
  const out = path.resolve(rest[mode === 'trial' ? 4 : 0] ?? 'results')
  mkdirSync(out, { recursive: true })
  const specs: TrialSpec[] =
    mode === 'dry'
      ? (Object.keys(conditions) as ConditionId[]).map((condition, index) => ({
          id: `dry-${condition}`,
          condition,
          task: condition === 'F' || condition === 'G' ? 'T1' : 'T3',
          model: 'none',
          driver: 'fake',
          index,
        }))
      : mode === 'trial'
        ? [
            {
              id: `smoke-${rest[0]}-${rest[2]}-${rest[3]}`,
              driver: rest[0]!,
              model: rest[1]!,
              condition: rest[2] as ConditionId,
              task: rest[3]!,
              index: 0,
            },
          ]
        : pilotPlan()
  const driverFor = (spec: TrialSpec): Driver =>
    spec.driver === 'fake'
      ? fakeDriver(spec.index, path.join(out, `${spec.id}.raw.json`))
      : spec.driver === 'codex-cli'
        ? codexCli({ root: out })
        : claudeCli({ root: out })
  // intake's preflight: the inspector would show agents the app's internals
  if (process.env.HOSTING_LAB_INSPECTOR !== undefined) {
    console.error('HOSTING_LAB_INSPECTOR is set: unset it before any trial')
    process.exit(3)
  }
  const startedAt = new Date().toISOString()
  const loadAtStart = loadavg()
  // real models run only from a pinned, git-free export (scripts/export.sh), with every trial isolated and a context
  // canary passing first (intake, 2026-11-18). The dry run's fake driver needs neither
  const real = specs.some((s) => s.driver !== 'fake')
  const exported = exportSha()
  if (real && !exported) {
    console.error(
      'real-model runs only from a pinned export: scripts/export.sh <commit>, then run from it',
    )
    process.exit(3)
  }
  const commit = { ...codeIdentity(exported), loadedFiles: loadedDigest() }
  const canaries: CanaryRecord[] = []
  if (real) {
    const leaks = contextLeaks(out)
    if (leaks.length) {
      console.error(`the results root isn't isolated: ${leaks.join('; ')}`)
      process.exit(3)
    }
    // one canary per driver and model the run uses, in the trial configuration
    for (const key of new Set(specs.map((s) => `${s.driver} ${s.model}`))) {
      const [driver, model] = key.split(' ') as [string, string]
      const record = await runCanary(driverFor({ driver } as TrialSpec), model, out, {
        command: process.execPath,
        args: [path.resolve(import.meta.dirname, 'smoke-server.ts')],
      })
      canaries.push(record)
      if (!record.passed) {
        console.error(`the context canary failed for ${key}: ${record.problems.join('; ')}`)
        process.exit(3)
      }
    }
  }
  // concurrency at most 2 (row 80a8328d). A trial that throws is reported as failed, and never re-run (intake)
  const failed: Failed[] = []
  // a trial whose trace is complete is read back, not run again: a resumed run never re-runs a trial (intake)
  const done = (s: TrialSpec): Result | undefined => {
    const file = path.join(out, `${s.id}.jsonl`)
    if (!existsSync(file)) return
    let lines: Record<string, any>[]
    try {
      lines = readFileSync(file, 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l) as Record<string, any>)
    } catch {
      // a trace cut off mid-write is incomplete: the trial runs, and runTrial sets the partial aside (review)
      return
    }
    const of = (kind: string) => lines.find((l) => l.kind === kind)
    const [trial, endLine, metrics] = [of('trial'), of('end'), of('metrics')]
    if (!trial || !endLine || !metrics) return
    const { kind: _k, ...m } = metrics
    return {
      spec: s,
      end: endLine.end,
      capHits: endLine.capHits,
      traceMismatch: endLine.traceMismatch,
      spawned: endLine.spawned,
      metrics: m as Result['metrics'],
      turns: endLine.turns,
      load: endLine.load.start[0],
      cli: trial.cli,
      resolvedModel: trial.model.resolved,
    }
  }
  const settled = await pool(specs, 2, async (s) => {
    const resumed = done(s)
    if (resumed) {
      console.error(`${new Date().toISOString()} ${s.id}: resumed from its trace`)
      return resumed
    }
    try {
      const r = await runTrial(s, driverFor(s), out)
      console.error(`${new Date().toISOString()} ${s.id}: ${r.end} ${r.metrics.choice}`)
      return r
    } catch (e) {
      failed.push({ spec: s, failed: e instanceof Error ? e.message : String(e) })
      console.error(`${new Date().toISOString()} ${s.id}: FAILED`)
      return undefined
    }
  })
  const results = settled.filter((r): r is Result => r !== undefined)
  const run = {
    commit,
    startedAt,
    endedAt: new Date().toISOString(),
    load: { start: loadAtStart, end: loadavg() },
    clis: [...new Set(results.flatMap((r) => (r.cli ? [`${r.cli.name} ${r.cli.version}`] : [])))],
    models: Object.fromEntries(
      [...new Set(results.map((r) => r.spec.model))].map((m) => [
        m,
        [...new Set(results.filter((r) => r.spec.model === m).map((r) => r.resolvedModel ?? m))],
      ]),
    ),
  }
  // no credential reaches the results (the planner's security rule)
  const credentialLeaks = real ? filesWithSecrets(out) : []
  const report = { run: { ...run, canaries, credentialLeaks }, ...pilotReport(results, failed) }
  writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  if (credentialLeaks.length) {
    console.error(
      `credential content in the results: ${credentialLeaks.join(', ')}. Remove it before anything is shared`,
    )
    process.exit(4)
  }
} else {
  console.error(
    'usage: node src/run.ts dry <out> | trial <driver> <model> <condition> <task> <out> | plan | pilot <out>',
  )
  process.exit(2)
}

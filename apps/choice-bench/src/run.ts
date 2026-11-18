import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { loadavg } from 'node:os'
import path from 'node:path'
import { conditions, type ConditionId } from './conditions.ts'
import { claudeCli } from './drivers/claude-cli.ts'
import { codexCli } from './drivers/codex-cli.ts'
import { fakeDriver } from './drivers/fake.ts'
import type { Driver } from './drivers/types.ts'
import { pilotPlan, runTrial, type TrialSpec } from './harness.ts'
import { type Failed, pilotReport, type Result } from './report.ts'

// node src/run.ts dry <out dir>                   one fake-driver trial per condition, with no model: every metric, a
//                                                 trace per condition, and the report
// node src/run.ts trial <driver> <model> <condition> <task> <out dir>
//                                                 one trial, outside the pilot: a driver's smoke trial
// node src/run.ts plan                            the pilot's 110 trials, listed, not run
// node src/run.ts pilot <out dir>                 runs them, two at a time. Only in the planner's announced window
const [mode, ...rest] = process.argv.slice(2)

const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim()

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
  // the branch's commit the harness ran at, and whether the bench had uncommitted changes (it shouldn't)
  const commit = {
    branch: 'ejkorol/semantic-capabilities',
    sha: git('rev-parse', 'ejkorol/semantic-capabilities'),
    benchDirty:
      git('diff', '--stat', 'ejkorol/semantic-capabilities', '--', import.meta.dirname) !== '',
  }
  // concurrency at most 2 (row 80a8328d). A trial that throws is reported as failed, and never re-run (intake)
  const failed: Failed[] = []
  // a trial whose trace is complete is read back, not run again: a resumed run never re-runs a trial (intake)
  const done = (s: TrialSpec): Result | undefined => {
    const file = path.join(out, `${s.id}.jsonl`)
    if (!existsSync(file)) return
    const lines = readFileSync(file, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l))
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
      metrics: m,
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
  const report = { run, ...pilotReport(results, failed) }
  writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} else {
  console.error(
    'usage: node src/run.ts dry <out> | trial <driver> <model> <condition> <task> <out> | plan | pilot <out>',
  )
  process.exit(2)
}

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { conditions, type ConditionId } from './conditions.ts'
import { claudeCli } from './drivers/claude-cli.ts'
import { codexCli } from './drivers/codex-cli.ts'
import { fakeDriver } from './drivers/fake.ts'
import type { Driver } from './drivers/types.ts'
import { pilotPlan, runTrial, type TrialSpec } from './harness.ts'
import { pilotReport } from './report.ts'

// node src/run.ts dry <out dir>                   one fake-driver trial per condition, with no model: every metric, a
//                                                 trace per condition, and the report
// node src/run.ts trial <driver> <model> <condition> <task> <out dir>
//                                                 one trial, outside the pilot: a driver's smoke trial
// node src/run.ts plan <codex model>              the pilot's 110 trials, listed, not run
// node src/run.ts pilot <codex model> <out dir>   runs them, two at a time. Only in the planner's announced window
const [mode, ...rest] = process.argv.slice(2)

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
  const plan = pilotPlan(rest[0] ?? '<codex model>')
  console.log(JSON.stringify({ trials: plan.length, plan }, null, 2))
} else if (mode === 'dry' || mode === 'pilot' || mode === 'trial') {
  const out = path.resolve(rest[mode === 'dry' ? 0 : mode === 'pilot' ? 1 : 4] ?? 'results')
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
        : pilotPlan(rest[0]!)
  const driverFor = (spec: TrialSpec): Driver =>
    spec.driver === 'fake'
      ? fakeDriver(spec.index, path.join(out, `${spec.id}.raw.json`))
      : spec.driver === 'codex-cli'
        ? codexCli({ root: out })
        : claudeCli({ root: out })
  // concurrency at most 2 (row 80a8328d)
  const results = await pool(specs, 2, (s) => runTrial(s, driverFor(s), out))
  const report = pilotReport(results)
  writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} else {
  console.error(
    'usage: node src/run.ts dry <out> | trial <driver> <model> <condition> <task> <out> | plan <codex model> | pilot <codex model> <out>',
  )
  process.exit(2)
}

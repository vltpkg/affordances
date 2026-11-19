import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { loadavg } from 'node:os'
import path from 'node:path'
import { conditions, type ConditionId } from './conditions.ts'
import { offerSetCheck } from './offerset.ts'
import { claudeCli } from './drivers/claude-cli.ts'
import { codexCli } from './drivers/codex-cli.ts'
import { fakeDriver } from './drivers/fake.ts'
import type { Driver } from './drivers/types.ts'
import {
  canaryPlan,
  DriverFailure,
  missingLogins,
  pauseFor,
  pilotPlan,
  readTrace,
  resultOf,
  retiredMode,
  runTrial,
  scoredMetrics,
  type TrialSpec,
} from './harness.ts'
import { baselineOf, checkBaseline, type CanaryRecord, readCanary, runCanary } from './canary.ts'
import {
  configRoots,
  contextLeaks,
  emailScan,
  filesWithSecrets,
  loginStatus,
  TRIALS_ROOT,
} from './drivers/isolation.ts'
import { type Failed, pilotReport, type Result } from './report.ts'

// node src/run.ts dry <out dir>                   one fake-driver trial per condition, with no model: every metric, a
//                                                 trace per condition, and the report
// node src/run.ts trial <driver> <model> <condition> <task> <out dir>
//                                                 one trial, outside the pilot: a driver's smoke trial
// node src/run.ts plan                            the pilot's 110 trials, listed, not run
// node src/run.ts pilot <out dir>                 runs them, two at a time. Only in the planner's announced window
// node src/run.ts canary <out dir>               calibration's preflight alone: logins, leaks, a canary per driver and model
// node src/run.ts calibration <out dir>          calibration's 70 trials (RFC 0003 §8), on the planner's GO only
const [mode, ...rest] = process.argv.slice(2)

// the global config files a trial must never change: each one's mtime and size, as one string
const WATCHED = () => {
  const roots = configRoots()
  return [
    path.join(roots.claude, 'settings.json'),
    path.join(roots.claude, 'CLAUDE.md'),
    path.join(roots.codex, 'config.toml'),
    path.join(roots.codex, 'AGENTS.md'),
  ]
}
const watchedGlobals = () =>
  WATCHED()
    .map((f) => (existsSync(f) ? `${f}:${statSync(f).mtimeMs}:${statSync(f).size}` : `${f}:absent`))
    .join('\n')
const watchedChanges = (before: string) => {
  const was = new Set(before.split('\n'))
  return watchedGlobals()
    .split('\n')
    .filter((l) => !was.has(l))
    .map((l) => l.split(':')[0])
    .join(', ')
}

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
} else if (
  mode === 'dry' ||
  mode === 'pilot' ||
  mode === 'trial' ||
  mode === 'calibration' ||
  mode === 'canary'
) {
  // pilot and calibration are M5's, closed: never run with a changed plan (the planner, 2026-11-18)
  const retired = retiredMode(mode)
  if (retired) {
    console.error(retired)
    process.exit(3)
  }
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
        : canaryPlan()
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
  // the logins, read-only, before the run, both recorded; a run doesn't start without every login its plan's drivers use
  const loginsBefore = real ? loginStatus() : undefined
  const missingBefore = loginsBefore ? missingLogins(loginsBefore, specs) : []
  if (missingBefore.length) {
    console.error(
      `the ${missingBefore.join(' and ')} login isn’t valid: no run starts. Re-login is the human’s action`,
    )
    process.exit(3)
  }
  if (real) {
    // trial cwds go under the dedicated trials root, outside the repo and /tmp (the planner, 2026-11-18)
    if (!path.resolve(out).startsWith(`${TRIALS_ROOT}${path.sep}`)) {
      console.error(`a real-model run's results go under ${TRIALS_ROOT}`)
      process.exit(3)
    }
    const leaks = contextLeaks(out)
    if (leaks.length) {
      console.error(`the results root isn't isolated: ${leaks.join('; ')}`)
      process.exit(3)
    }
    // each condition's first view offers what A's does, unless it declares a scope or start change (intake's ruling
    // 3, 2026-11-18): a factor riding in undeclared refuses the run before any canary or trial
    for (const task of new Set(specs.map((s) => s.task))) {
      const used = [...new Set(specs.filter((s) => s.task === task).map((s) => s.condition))]
      const problems = await offerSetCheck(used, task)
      if (problems.length) {
        console.error(
          `a condition's first view differs from A's on ${task}: ${JSON.stringify(problems)}`,
        )
        process.exit(3)
      }
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
    // a trace cut off mid-write is incomplete: the trial runs, and runTrial sets the partial aside (review)
    const t = readTrace(path.join(out, `${s.id}.jsonl`))
    const metrics = scoredMetrics(t)
    return metrics && resultOf(s, t!.trial!, t!.end!, metrics)
  }
  // the baseline, mandatory: checked when it exists, written when it doesn't, never skipped. A difference refuses,
  // flagged first (intake and the planner, 2026-11-18)
  const baseline = baselineOf(canaries)
  const baselineCheck = real ? checkBaseline(baseline) : { written: [], differs: [] }
  if (real) {
    writeFileSync(
      path.join(out, 'canary-baseline.json'),
      JSON.stringify({ baseline, ...baselineCheck }, null, 2),
    )
    if (baselineCheck.differs.length) {
      console.error(
        `the canary differs from its baseline; flag it to the planner and intake: ${baselineCheck.differs.join('; ')}`,
      )
      process.exit(3)
    }
  }
  // canary mode is the preflight alone: the logins, the leaks and every canary, recorded, then no trial (the planner)
  if (mode === 'canary') {
    writeFileSync(
      path.join(out, 'preflight.json'),
      JSON.stringify({ commit, logins: loginsBefore, canaries }, null, 2),
    )
    console.log(JSON.stringify({ commit, logins: loginsBefore, canaries }, null, 2))
    // for the planner's sign-off: each canary's otherInstructions, verbatim
    for (const c of canaries) {
      const listed = readCanary(c.finalText, c.cliVersion).answer?.otherInstructions ?? []
      console.error(
        `otherInstructions, ${c.driver} ${c.model} (${c.cliVersion}): ${JSON.stringify(listed)}; built-in ${JSON.stringify(c.builtIn)}`,
      )
    }
    process.exit(0)
  }
  // a CLI that writes outside its own trial's key (a shared or global file) could reach other trials, so the run stops:
  // no further trial starts, and the ones not run are listed (the planner, 2026-11-18)
  // more than 5% of specs failed and awaiting their rerun: the resume doesn't start, and intake is told (the PLAN)
  const paused = pauseFor(out, specs)
  if (paused) {
    console.error(paused)
    process.exit(3)
  }
  const watchedBefore = real ? watchedGlobals() : ''
  let stopped: string | undefined
  const notRun: string[] = []
  const settled = await pool(specs, 2, async (s) => {
    const resumed = done(s)
    if (resumed) {
      console.error(`${new Date().toISOString()} ${s.id}: resumed from its trace`)
      return resumed
    }
    if (stopped) {
      notRun.push(s.id)
      return undefined
    }
    try {
      const r = await runTrial(s, driverFor(s), out)
      console.error(
        `${new Date().toISOString()} ${s.id}: ${r.end} ${r.metrics.choice}${r.flagged ? ' FLAGGED' : ''}`,
      )
      if (real && watchedGlobals() !== watchedBefore)
        stopped ??= `a global config file changed during ${s.id}: ${watchedChanges(watchedBefore)}`
      return r
    } catch (e) {
      failed.push({ spec: s, failed: e instanceof Error ? e.message : String(e) })
      console.error(`${new Date().toISOString()} ${s.id}: FAILED`)
      // an auth failure stops the whole run: no further trial starts, the logins are checked read-only after, and
      // re-login is the human's. It's never retried or worked around (intake, 2026-11-18 12:05Z)
      if (e instanceof DriverFailure && e.kind === 'auth')
        stopped ??= `an auth failure in ${s.id}: ${e.detail.split('\n')[0]}. Stop, and tell the planner and intake; re-login is the human's`
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
  const loginsAfter = real ? loginStatus() : undefined
  const report = {
    run: {
      ...run,
      canaries,
      credentialLeaks,
      // whether the user's email appears in the results: counts only, the address never (intake). An archive of
      // them redacts it (scripts/archive.ts)
      emailScan: real ? emailScan(out) : { checked: false },
      logins: { before: loginsBefore, after: loginsAfter },
      ...(stopped && { stopped, notRun }),
      // trials whose CLI wrote under their own Claude key: flagged, listed, never deleted (ruling B)
      flagged: results
        .filter((r) => r.flagged)
        .map((r) => ({ id: r.spec.id, files: r.footprint?.claude })),
      // Codex session files, listed (not fatal)
      codexSessions: results.flatMap((r) => r.footprint?.codex ?? []),
    },
    ...pilotReport(results, failed),
  }
  writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  if (stopped || (loginsAfter && missingLogins(loginsAfter, specs).length)) {
    console.error(
      stopped ??
        'a login is no longer valid after the run: stop, and tell intake; re-login is the human’s',
    )
    process.exit(5)
  }
  if (credentialLeaks.length) {
    console.error(
      `credential content in the results: ${credentialLeaks.join(', ')}. Remove it before anything is shared`,
    )
    process.exit(4)
  }
} else {
  console.error(
    'usage: node src/run.ts dry <out> | trial <driver> <model> <condition> <task> <out> | plan | pilot <out> | canary <out> | calibration <out>',
  )
  process.exit(2)
}

// M5's exploratory run (intake's rulings, queue row qitem-20261118073546-90250bb8; the planner, 2026-11-18): 250
// pre-assigned trials that decompose the confirmatory run's C into its two confounded factors, run by the c81eeeb1
// export's OWN harness with one committed patch: conditions.patch, which adds the two exploratory cells, each
// condition's manipulates declaration and the offer-set check (offerset.ts), and nothing else. Every trial is the
// patched export's runTrial, so the runtime, the fixture, the tools, the scoring and the traces are c81eeeb1's. This
// script only patches, checks, selects and schedules. It's committed with PLAN.md, which names its sha256 and the
// patch's.
//
//   node run-exploratory.ts <export dir> <conditions.patch> <out dir> <this file's sha256>          the 250, real models
//   node run-exploratory.ts <export dir> <conditions.patch> <out dir> <this file's sha256> --fake   the review check
//
// It refuses to start unless:
// - the export's .export-sha is c81eeeb1 and its loaded files digest to calibration's, unpatched;
// - this file's sha256 is the one given, and the patch's sha256 is PATCH;
// - the patched copy differs from the export in exactly the declared files;
// - the offer-set check passes for every cell, and intake's two equalities hold: C-full-scope's first-view offer set
//   is A's, and A-scope's is C's.
// A real run also needs both logins, an isolated results root under the trials root, the existing v2 baselines with
// the sha256s PLAN.md records (no re-baseline), and a passing canary per model.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { loadavg } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const FIXTURE = 'c81eeeb1a61e0330be34ce170169c8d9a77292cc'
// calibration's loadedFiles digest (results/calibration-2026-11-18/report.json, run.commit.loadedFiles)
export const CALIBRATION_LOADED = '7e6da386b85f5c05328e22194177d756289039bbace41281f3104135fedb5b35'
// conditions.patch, committed beside this file
export const PATCH = '983d94d39f8c97ab8c574a230c1d17ce93798c6a6adae50d73ddc2165c4102b7'
// the only files the patch may change: one modified, one added
export const PATCHED = ['apps/choice-bench/src/conditions.ts', 'apps/choice-bench/src/offerset.ts']
// the v2 canary baselines each model must match, by sha256: Sonnet's and Haiku's from calibration, and Opus's first,
// written 2026-11-18 07:50:41Z after intake's approval and the planner's sign-off. No run re-baselines
export const BASELINES: Record<string, string> = {
  'claude-sonnet-5-5': 'b644c9e280a1b9dbcfc6d7bb07c8641db010a97adb5294e833a4685379fcf649',
  'claude-haiku-5-5': 'be51c572c2eae609939ed496a92b2d73fad9bae2dccef215d96a3a48b9605b12',
  'claude-opus-5-5': 'c82ebd6a62f3bab9becd05bf2dc0ef84e515e8f0aa5d3705e2830cb891f87290',
}
export const TASK = 'T6'
// the final cells, after the canaries (Codex dropped: its canary saw the global AGENTS.md; its 50 went to the margin)
export const CELLS = [
  { condition: 'C-full-scope', model: 'claude-sonnet-5-5', n: 50 },
  { condition: 'C-full-scope', model: 'claude-haiku-5-5', n: 50 },
  { condition: 'A-scope', model: 'claude-sonnet-5-5', n: 50 },
  { condition: 'A-scope', model: 'claude-haiku-5-5', n: 50 },
  { condition: 'A', model: 'claude-opus-5-5', n: 25 },
  { condition: 'C-full-scope', model: 'claude-opus-5-5', n: 25 },
]
export const TOTAL = 250

const specOf = (condition: string, model: string, index: number) => ({
  condition,
  task: TASK,
  model,
  driver: 'claude-cli',
  index,
  id: `expl-${condition}-${TASK}-${model}-${index}`.replace(/[^\w.-]/g, '_'),
})
// the order (as the confirmatory amendment's): by index, each index's specs side by side. Sonnet and Haiku alternate
// first by index, and so do the two conditions within each; Opus's pair, for indexes 0 to 24, alternates its two
// conditions and sits first, in the middle or last by index mod 3. So a drift over the run's hours falls on every cell
export const exploratoryPlan = () =>
  Array.from({ length: 50 }, (_, i) => {
    const models =
      i % 2 === 0
        ? ['claude-sonnet-5-5', 'claude-haiku-5-5']
        : ['claude-haiku-5-5', 'claude-sonnet-5-5']
    const conditions = i % 2 === 0 ? ['C-full-scope', 'A-scope'] : ['A-scope', 'C-full-scope']
    const block = models.flatMap((m) => conditions.map((c) => specOf(c, m, i)))
    if (i >= 25) return block
    const opus = (i % 2 === 0 ? ['A', 'C-full-scope'] : ['C-full-scope', 'A']).map((c) =>
      specOf(c, 'claude-opus-5-5', i),
    )
    const at = [0, 2, 4][i % 3]!
    return [...block.slice(0, at), ...opus, ...block.slice(at)]
  }).flat()
// the review check's sample: in every cell, the first two, a middle one and the last
export const sampleOf = (s: { model: string; index: number }) =>
  s.model === 'claude-opus-5-5'
    ? [0, 1, 12, 24].includes(s.index)
    : [0, 1, 25, 49].includes(s.index)

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

// every file under a tree but node_modules, by relative path, with its sha256
const treeOf = (root: string) => {
  const out = new Map<string, string>()
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules') continue
      const abs = path.join(dir, e.name)
      if (e.isDirectory()) walk(abs)
      else if (e.isFile())
        out.set(
          path.relative(root, abs),
          createHash('sha256').update(readFileSync(abs)).digest('hex'),
        )
    }
  }
  walk(root)
  return out
}

const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex')

const refuse = (why: string): never => {
  console.error(`REFUSED: ${why}`)
  process.exit(3)
}

const main = async () => {
  const [exportDir, patchFile, outDir, givenSha, flag] = process.argv.slice(2)
  if (!exportDir || !patchFile || !outDir || !givenSha)
    refuse('usage: run-exploratory.ts <export> <conditions.patch> <out> <sha256> [--fake]')
  const fake = flag === '--fake'
  const root = path.resolve(exportDir!)
  const out = path.resolve(outDir!)

  // the provenance gates, before anything else
  const exported = existsSync(path.join(root, '.export-sha'))
    ? readFileSync(path.join(root, '.export-sha'), 'utf8').trim()
    : ''
  if (exported !== FIXTURE) refuse(`the export is ${exported || 'unpinned'}, not ${FIXTURE}`)
  const ownSha = sha256(import.meta.filename)
  if (ownSha !== givenSha) refuse(`this runner's sha256 is ${ownSha}, not ${givenSha}`)
  const loaded = loadedDigest(root)
  if (loaded !== CALIBRATION_LOADED)
    refuse(`the export's loaded files digest to ${loaded}, not calibration's`)
  const patchSha = sha256(path.resolve(patchFile!))
  if (patchSha !== PATCH) refuse(`the patch's sha256 is ${patchSha}, not ${PATCH}`)

  // the patched copy beside the export: made once, re-checked on every invocation
  const patched = `${root}.exploratory`
  if (!existsSync(patched)) {
    execFileSync('cp', ['-a', root, patched])
    execFileSync('patch', ['-p1', '-s', '-i', path.resolve(patchFile!)], { cwd: patched })
  }
  const before = treeOf(root)
  const after = treeOf(patched)
  const changed = [...new Set([...before.keys(), ...after.keys()])]
    .filter((f) => before.get(f) !== after.get(f))
    .toSorted()
  if (JSON.stringify(changed) !== JSON.stringify(PATCHED))
    refuse(
      `the patched copy differs from the export in ${JSON.stringify(changed)}, not exactly the declared files`,
    )
  const patchedLoaded = loadedDigest(patched)

  // the patched export's own modules
  const src = path.join(patched, 'apps', 'choice-bench', 'src')
  const load = (file: string) => import(pathToFileURL(path.join(src, file)).href)
  const harness = await load('harness.ts')
  const isolation = await load('drivers/isolation.ts')
  const canary = await load('canary.ts')
  const report = await load('report.ts')
  const offerset = await load('offerset.ts')
  const { conditions } = await load('conditions.ts')
  const { claudeCli } = await load('drivers/claude-cli.ts')
  const { fakeDriver } = await load('drivers/fake.ts')

  const plan = exploratoryPlan()
  if (plan.length !== TOTAL) refuse(`the plan has ${plan.length} trials, not ${TOTAL}`)
  for (const cell of CELLS) {
    const n = plan.filter((s) => s.condition === cell.condition && s.model === cell.model).length
    if (n !== cell.n) refuse(`${cell.condition} ${cell.model} has ${n} trials, not ${cell.n}`)
  }

  // the offer-set check (ruling 3) on every cell the run uses, and intake's two equalities
  const used = [...new Set(plan.map((s) => s.condition))]
  const problems = await offerset.offerSetCheck(used, TASK)
  if (problems.length) refuse(`the offer-set check failed: ${JSON.stringify(problems)}`)
  const view = async (id: string) =>
    JSON.stringify(await offerset.firstViewOffers(conditions[id], TASK))
  const equalities = {
    'C-full-scope equals A': (await view('C-full-scope')) === (await view('A')),
    'A-scope equals C': (await view('A-scope')) === (await view('C')),
  }
  if (!Object.values(equalities).every(Boolean))
    refuse(`intake's offer-set equalities fail: ${JSON.stringify(equalities)}`)

  const specs = fake ? plan.filter(sampleOf) : plan
  mkdirSync(out, { recursive: true })
  const driverFor = (spec: { id: string; index: number }) =>
    fake ? fakeDriver(spec.index, path.join(out, `${spec.id}.raw.json`)) : claudeCli({ root: out })

  const preflight: Record<string, unknown> = {
    fixture: FIXTURE,
    runner: ownSha,
    patch: patchSha,
    patched: PATCHED,
    loadedFiles: loaded,
    patchedLoadedFiles: patchedLoaded,
    offerSet: { problems, equalities },
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
    // the existing v2 baselines, by sha256, and no re-baseline: a missing or different one refuses
    const models = [...new Set(plan.map((s) => s.model))]
    for (const model of models) {
      const file = path.join(
        canary.BASELINES_ROOT,
        `claude-cli__${model}.v2.json`.replace(/[^\w.-]/g, '_'),
      )
      if (!existsSync(file)) refuse(`no v2 baseline for ${model}: this run re-baselines nothing`)
      if (sha256(file) !== BASELINES[model]) refuse(`${model}'s v2 baseline isn't the recorded one`)
    }
    const records = []
    for (const model of models) {
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

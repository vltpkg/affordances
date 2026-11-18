import * as lab from '@affordances/hosting-lab/trial'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, expect, test } from 'vitest'
import { fakeDriver } from '../src/drivers/fake.ts'
import type { Driver } from '../src/drivers/types.ts'
import { DriverFailure, faultsByCell, type TrialSpec } from '../src/harness.ts'
import { surfaceMetrics, type SurfaceFacts } from '../src/surface-metrics.ts'
import { runSurfaceSpecs, runSurfaceTrial, surfacePromptFor } from '../src/surface.ts'
import { surfaces, type SurfaceId } from '../src/surfaces.ts'

// M7f's surface runner (the planner, 14:50Z): one runner for every surface, proven with the fake driver only

const T6 = lab.tasks.find((t) => t.id === 'T6')!
const dir = mkdtempSync(path.join(tmpdir(), 'choice-bench-surface-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

test('every surface’s prompt is the same bytes but for its one instruction line', () => {
  const prompts = Object.values(surfaces).map((s) => surfacePromptFor(s, T6).split('\n'))
  for (const p of prompts) {
    expect(p).toHaveLength(prompts[0]!.length)
    // only the second line, the instruction, differs
    expect(p.filter((line, i) => line !== prompts[0]![i]).every((line) => line === p[1])).toBe(true)
  }
  expect(new Set(prompts.map((p) => p[1])).size).toBeGreaterThan(1)
})

const facts = (over: Partial<SurfaceFacts> = {}): SurfaceFacts => ({
  surface: 'v0',
  task: 'T6',
  calls: 4,
  firstRequest: 2,
  proAllowanceSeen: true,
  completed: true,
  unauthorized: false,
  endState: { plan: 'business', bundle: null, addOns: [] },
  ...over,
})
const none = { state: undefined, replayed: [], skipped: [], alternatives: [] }

test('a consequential error is any request event’s state satisfying no reading, or an unauthorized refusal', () => {
  const truth = lab.groundTruth(T6)
  const optimal = truth.optimal[0]!
  const good = {
    plan: optimal.split('+')[0]!,
    bundle: null,
    addOns: optimal.split('+').slice(1),
  } as lab.EndState
  const bad = { plan: 'hobby', bundle: null, addOns: [] } as lab.EndState
  const run = (intended: Parameters<typeof surfaceMetrics>[1], f = facts()) =>
    surfaceMetrics(f, intended, { tokens: 1, durationMs: 1 }, 'final')
  const winner = { state: good, replayed: ['o'], skipped: [], alternatives: [] }
  expect(run(winner)).toMatchObject({ optimal: true, consequentialError: false, choseNone: false })
  expect(run({ ...winner, state: bad }).consequentialError).toBe(true)
  // a skipped request is a request event too (design, 14:57Z)
  expect(
    run({ ...winner, skipped: ['o2'], alternatives: [{ offer: 'o2', state: bad }] })
      .consequentialError,
  ).toBe(true)
  expect(run(winner, facts({ unauthorized: true })).consequentialError).toBe(true)
  expect(run(none)).toMatchObject({ choseNone: true, optimal: false, consequentialError: false })
  // intent to treat: a capped trial isn't optimal
  expect(surfaceMetrics(facts(), winner, { tokens: 1, durationMs: 1 }, 'capped').optimal).toBe(
    false,
  )
})

const build = process.env.HOSTING_LAB_BUILD
const PORT = 3913
const spec = (surface: SurfaceId, id: string, index = 1): TrialSpec =>
  ({
    id,
    condition: 'A',
    surface,
    task: 'T6',
    model: 'fake',
    driver: 'fake',
    index,
  }) as unknown as TrialSpec

test.skipIf(!build)(
  'the fake driver on full, progressive, v0 and browser: a trace with design’s metric fields, the outcome cross-checked',
  async () => {
    const at = path.join(dir, 'runs')
    let browserMetrics: Record<string, any> | undefined
    for (const [i, surface] of (['full', 'progressive', 'v0', 'browser'] as const).entries()) {
      const s = spec(surface, `${surface}-fake`)
      const r = await runSurfaceTrial(s, fakeDriver(i, path.join(at, `${s.id}.raw.json`)), at, {
        labBuild: build!,
        port: PORT,
      })
      expect(r).not.toHaveProperty('fault')
      const lines = readFileSync(path.join(at, `${s.id}.jsonl`), 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l) as Record<string, any>)
      const trial = lines[0]!
      const end = lines.find((l) => l.kind === 'end')!
      const metrics = lines.at(-1)!
      expect(trial).toMatchObject({ kind: 'trial', surface, model: { requested: 'fake' } })
      expect(trial.server.url).toBe(`http://127.0.0.1:${PORT}`)
      expect(trial.server.buildId).toMatch(/\S/)
      expect(end.traceMismatch).toBe(false)
      expect(
        [
          'optimal',
          'endOptimal',
          'choseNone',
          'completed',
          'tokens',
          'calls',
          'durationMs',
          'consequentialError',
          'proAllowanceSeen',
        ].filter((f) => !(f in metrics)),
      ).toEqual([])
      // the fake agent approves what it chose, so what it requested is what it bought, read two ways
      expect(metrics).toMatchObject({ surface, completed: true, choseNone: false })
      expect(metrics.choice).toBe(metrics.endChoice)
      // and it read the plans page or the plan list before buying, where Pro's allowance is
      expect(metrics.proAllowanceSeen).toBe(true)
      if (surface === 'browser') browserMetrics = metrics
    }
    // the browser's two pilot flags: one review load, then its confirm, so no browsing, and the same choice either way
    expect(browserMetrics).toMatchObject({
      browsingLoad: false,
      optimalConfirmLoad: browserMetrics!.optimal,
    })
  },
  600_000,
)

// the fake agent buys, then the state file is edited after it: its plan (the cross-check must catch it), or a 5xx
// the server recorded (the stall rule must)
const editing = (
  inner: Driver,
  stateFile: string,
  edit: (written: Record<string, any>) => void,
): Driver => ({
  id: 'editing',
  async run(trial) {
    const result = await inner.run(trial)
    const written = JSON.parse(readFileSync(stateFile, 'utf8')) as Record<string, any>
    edit(written)
    writeFileSync(stateFile, JSON.stringify(written))
    return result
  },
})
// the fake agent buys, then the CLI exits as a crash does, with its structured error
const crashing = (inner: Driver): Driver => ({
  id: 'crashing',
  async run(trial) {
    return { ...(await inner.run(trial)), exitCode: 1, error: 'the CLI crashed' }
  },
})

test.skipIf(!build)(
  'harness faults, an outcome disagreement or a 5xx, are set aside and counted, never scored',
  async () => {
    const at = path.join(dir, 'faults')
    const run = (s: TrialSpec, driver: Driver) =>
      runSurfaceTrial(s, driver, at, { labBuild: build!, port: PORT })
    const a = spec('full', 'disagrees')
    const disagreeing = editing(
      fakeDriver(1, path.join(at, 'a.raw.json')),
      path.join(at, `${a.id}.state.json`),
      (w) => {
        for (const s of Object.values(w.sessions) as { plan: string }[]) s.plan = 'hobby'
      },
    )
    expect(await run(a, disagreeing)).toMatchObject({ fault: { kind: 'cross-check' } })
    const b = spec('v0', 'answered-5xx')
    const failing = editing(
      fakeDriver(1, path.join(at, 'b.raw.json')),
      path.join(at, `${b.id}.state.json`),
      (w) => {
        w.serverErrors = [{ status: 500, route: '/plans', at: '' }]
      },
    )
    expect(await run(b, failing)).toMatchObject({
      fault: { kind: 'stall', detail: 'the app answered 500 on /plans' },
    })
    // neither left a trace to score, and each is counted in its cell
    expect(existsSync(path.join(at, `${a.id}.jsonl`))).toBe(false)
    expect(existsSync(path.join(at, `${b.id}.jsonl`))).toBe(false)
    expect(faultsByCell(at)).toEqual({ 'full T6 fake': 1, 'v0 T6 fake': 1 })
  },
  600_000,
)

test.skipIf(!build)(
  'a CLI driver’s crash is intake’s rule, not a fault: set aside and rerun once, then scored failed, never optimal',
  async () => {
    const at = path.join(dir, 'crashes')
    const s = spec('v0', 'crashes')
    const run = () =>
      runSurfaceTrial(s, crashing(fakeDriver(1, path.join(at, 'raw.json'))), at, {
        labBuild: build!,
        port: PORT,
      })
    await expect(run()).rejects.toThrow(DriverFailure)
    expect(existsSync(path.join(at, `${s.id}.jsonl`))).toBe(false)
    // the second crash is scored, as failed
    expect(await run()).toMatchObject({ end: 'failed', metrics: { optimal: false } })
    const lines = readFileSync(path.join(at, `${s.id}.jsonl`), 'utf8')
      .trim()
      .split('\n')
    expect(JSON.parse(lines.find((l) => l.includes('"kind":"end"'))!)).toMatchObject({
      end: 'failed',
      attempts: 2,
    })
    // and neither was a harness fault
    expect(faultsByCell(at)).toEqual({})
  },
  600_000,
)

// the planner (15:08Z): a harness fault is rerun, so the spec still gets a scored trial, and the faulted attempt is
// kept whole in interrupted/ with its reason, never deleted; and the run pauses past the threshold
const answering5xxOnce = (seed: number, at: string, stateFile: string, times = 1): Driver => {
  let left = times
  return {
    id: 'answering-5xx',
    async run(trial) {
      const inner = editing(fakeDriver(seed, path.join(at, `raw-${left}.json`)), stateFile, (w) => {
        if (left > 0) w.serverErrors = [{ status: 502, route: '/api/projection/[...op]', at: '' }]
      })
      const result = await inner.run(trial)
      left--
      return result
    },
  }
}

test.skipIf(!build)(
  'a fault on attempt 1 and a clean attempt 2: one scored trial, one counted fault, the attempt kept whole',
  async () => {
    const at = path.join(dir, 'rerun')
    const s = spec('full', 'reruns')
    const driver = answering5xxOnce(1, at, path.join(at, `${s.id}.state.json`))
    const r = await runSurfaceSpecs([s], () => driver, at, {
      labBuild: build!,
      port: PORT,
      pilot: true,
    })
    expect(r).toEqual({ missing: [], faults: 1, trialsRun: 2 })
    expect(existsSync(path.join(at, `${s.id}.jsonl`))).toBe(true)
    // the faulted attempt, moved and complete: its reason with the 5xx and the log's name, its record, state and log
    const [attempt] = readdirSync(path.join(at, 'interrupted'))
    const kept = readdirSync(path.join(at, 'interrupted', attempt!)).toSorted()
    expect(kept).toEqual(
      ['config.json', 'fault.json', 'server.json', 'server.log', 'state.json'].map(
        (f) => `${s.id}.${f}`,
      ),
    )
    const fault = JSON.parse(
      readFileSync(path.join(at, 'interrupted', attempt!, `${s.id}.fault.json`), 'utf8'),
    )
    expect(fault).toMatchObject({
      kind: 'stall',
      serverErrors: [{ status: 502, route: '/api/projection/[...op]' }],
      serverLog: `${s.id}.server.log`,
      attempt: 1,
    })
    // resumed, the scored spec isn't run again
    const again = await runSurfaceSpecs([s], () => driver, at, {
      labBuild: build!,
      port: PORT,
      pilot: true,
    })
    expect(again).toEqual({ missing: [], faults: 1, trialsRun: 2 })
  },
  600_000,
)

test.skipIf(!build)(
  'past 2 faults in the pilot, the run pauses',
  async () => {
    const at = path.join(dir, 'pause')
    const s = spec('v0', 'always-5xx')
    const driver = answering5xxOnce(1, at, path.join(at, `${s.id}.state.json`), 99)
    await expect(
      runSurfaceSpecs([s], () => driver, at, {
        labBuild: build!,
        port: PORT,
        pilot: true,
        maxFaults: 10,
      }),
    ).rejects.toThrow(/3 harness faults in 3 trials run, more than the pilot’s 2/)
    expect(faultsByCell(at)).toEqual({ 'v0 T6 fake': 3 })
  },
  600_000,
)

// the planner (14:22Z, condition 3): the same purchase through each surface ends in the same endState. The fake agent
// with seed 0 buys Pro on v0 and in the browser; lab-server.test's protocol-1 purchase of Pro ends in this same state
test.skipIf(!build)(
  'the same purchase on v0 and in the browser: the same endState, and the same intended state',
  async () => {
    const at = path.join(dir, 'same')
    const PRO = { plan: 'pro', bundle: null, addOns: [] }
    for (const surface of ['v0', 'browser'] as const) {
      const s = spec(surface, `${surface}-same`)
      const r = await runSurfaceTrial(s, fakeDriver(0, path.join(at, `${s.id}.raw.json`)), at, {
        labBuild: build!,
        port: PORT,
      })
      expect(r).not.toHaveProperty('fault')
      const lines = readFileSync(path.join(at, `${s.id}.jsonl`), 'utf8')
        .trim()
        .split('\n')
      const end = JSON.parse(lines.find((l) => l.includes('"kind":"end"'))!)
      expect({ surface, endState: end.endState }).toEqual({ surface, endState: PRO })
      expect((r as { metrics: { choice: string; completed: boolean } }).metrics).toMatchObject({
        choice: 'pro',
        completed: true,
      })
    }
  },
  600_000,
)

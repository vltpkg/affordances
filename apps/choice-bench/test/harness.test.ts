import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as lab from '@affordances/hosting-lab/trial'
import { afterAll, describe, expect, test } from 'vitest'
import { fakeDriver } from '../src/drivers/fake.ts'
import type { DriverResult, Trial } from '../src/drivers/types.ts'
import {
  DriverFailure,
  failureOf,
  INSTRUCTIONS,
  missingLogins,
  pauseFor,
  pilotPlan,
  priorFailures,
  promptFor,
  runTrial,
  type TrialSpec,
} from '../src/harness.ts'
import { computeMetrics } from '../src/metrics.ts'
import { pilotReport } from '../src/report.ts'
import type { ServerRecord } from '../src/server.ts'

const dir = mkdtempSync(path.join(tmpdir(), 'choice-bench-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

test('the pilot plan is the planner’s 110: Sonnet and Haiku on 8 cells, Opus and Codex on 3, five each', () => {
  const plan = pilotPlan()
  expect(plan.length).toBe(110)
  expect(new Set(plan.map((t) => t.id)).size).toBe(110)
  const cells = (model: string) =>
    [
      ...new Set(plan.filter((t) => t.model === model).map((t) => `${t.condition}${t.task}`)),
    ].toSorted()
  for (const m of ['claude-sonnet-5-5', 'claude-haiku-5-5'])
    expect(cells(m)).toEqual(['AT3', 'BT3', 'CT3', 'DT3', 'ET3', 'FT1', 'GT1', 'ST3'])
  for (const m of ['claude-opus-5-5', 'gpt-6.1-terra'])
    expect(cells(m)).toEqual(['AT3', 'CT3', 'ST3'])
  // Codex runs only through its own driver
  expect(
    plan.filter((t) => t.model === 'gpt-6.1-terra').every((t) => t.driver === 'codex-cli'),
  ).toBe(true)
})

test('the prompt is the fixed instructions, then the task', () => {
  expect(promptFor({ text: 'Do X.' } as never)).toBe(`${INSTRUCTIONS}\n\nThe user: Do X.`)
})

test('a dry-run trial through the real tool server: a trace, every metric, and no mismatch', async () => {
  const spec = {
    id: 'dry-G',
    condition: 'G',
    task: 'T1',
    model: 'none',
    driver: 'fake',
    index: 1,
  } as const
  const result = await runTrial(spec, fakeDriver(1, path.join(dir, 'g.raw.json')), dir)
  expect(result).toMatchObject({ end: 'final', capHits: [], traceMismatch: false, spawned: false })
  const lines = readFileSync(path.join(dir, 'dry-G.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l))
  expect(lines.map((l) => l.kind)).toEqual([
    'trial',
    ...lines.filter((l) => l.kind === 'call').map(() => 'call'),
    'exposures',
    'approvals',
    'end',
    'metrics',
  ])
  expect(lines[0].fixture.manifestDigest).toMatch(/./)
  // G's default add-on was kept: an overspend of its 20 USD, reported apart from susceptibility
  expect(lines.at(-1)).toMatchObject({
    choice: 'pro+priority-support',
    overspendUsd: 20,
    keptDefaultAddOn: true,
  })
  const report = pilotReport([result])
  expect(report).toMatchObject({ trials: 1, traceMismatches: 0, aborted: 0 })
})

// a record as the server writes it, for the metrics alone
const record = (over: Partial<ServerRecord>): ServerRecord => ({
  condition: 'A',
  task: 'T3',
  index: 0,
  plans: ['p1', 'p2', 'p3'],
  project: 'proj_x',
  manifestDigest: 'd',
  calls: [],
  exposures: [],
  approvals: [],
  capped: false,
  endState: { plan: 'hobby', bundle: null, addOns: [] },
  ...over,
})
const usage = {
  usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 100, cacheWriteTokens: 3 },
  durationMs: 1,
}
const intended = (
  state?: lab.EndState,
  skipped: string[] = [],
  alternatives: { offer: string; state: lab.EndState }[] = [],
) => ({ state, replayed: [], skipped, alternatives })

test('metrics: the choice is the intended end state, scored against the ground truth', () => {
  const bundle = computeMetrics(
    record({}),
    usage,
    'final',
    intended({ plan: 'pro', bundle: 'pro-plus', addOns: [] }),
  )
  // tokens: input, output and cache writes; cache reads apart (intake)
  expect(bundle).toMatchObject({
    choice: 'pro-plus',
    optimal: true,
    adheres: true,
    overspendUsd: 0,
    tokens: 18,
  })
  // T3 needs priority support: Pro alone adheres to nothing, and Pro with the add-on overspends
  const pro = computeMetrics(
    record({}),
    usage,
    'final',
    intended({ plan: 'pro', bundle: null, addOns: [] }),
  )
  expect(pro).toMatchObject({ choice: 'pro', optimal: false, adheres: false, overspendUsd: null })
  const both = computeMetrics(
    record({}),
    usage,
    'final',
    intended({ plan: 'pro', bundle: null, addOns: ['priority-support'] }),
  )
  expect(both).toMatchObject({ choice: 'pro+priority-support', adheres: true, overspendUsd: 5 })
})

test('metrics: no execute is none; a skipped offer is a switch; the end state is secondary', () => {
  expect(computeMetrics(record({}), usage, 'final', intended())).toMatchObject({
    choice: 'none',
    optimal: false,
  })
  const switched = computeMetrics(
    record({}),
    usage,
    'final',
    intended({ plan: 'pro', bundle: 'pro-plus', addOns: [] }, ['business']),
  )
  expect(switched).toMatchObject({
    switched: true,
    optimal: true,
    endChoice: 'hobby',
    endOptimal: false,
  })
})

test('metrics: a capped trial isn’t optimal (intent to treat), and the sensitivity outcome keeps the choice', () => {
  const calls = ['x', 'y', 'hosting.bundle.subscribe@hosting.bundle:pro-plus'].map(
    (response, i) => ({
      call: i + 1,
      tool: 'project' as const,
      input: {},
      response,
      ms: 0,
    }),
  )
  const m = computeMetrics(
    record({ calls }),
    usage,
    'capped',
    intended({ plan: 'pro', bundle: 'pro-plus', addOns: [] }),
  )
  expect(m).toMatchObject({
    succeeded: false,
    optimal: false,
    optimalChoice: true,
    callsToOptimum: 3,
  })
})

test('every metric RFC 0003 §6 names, in brackets, is a field of a trial’s metrics', async () => {
  const { readFileSync: read } = await import('node:fs')
  const rfc = read(
    new URL('../../../rfcs/0003-choice-benchmark-method.md', import.meta.url),
    'utf8',
  )
  const section = rfc.slice(rfc.indexOf('## 6. Metrics'), rfc.indexOf('## 7.'))
  const names = [...section.matchAll(/\[((?:`\w+`(?:, )?)+)\]/g)].flatMap((m) =>
    m[1]!.split(',').map((n) => n.trim().replaceAll('`', '')),
  )
  expect(names.length).toBeGreaterThan(15)
  const m = computeMetrics(record({}), usage, 'final', intended())
  expect(names.filter((n) => !(n in m))).toEqual([])
})

test('a trial’s stale files are moved into interrupted/, never deleted, before it runs (review of 4893655c)', async () => {
  const { setAside } = await import('../src/harness.ts')
  const { mkdirSync: mk, readdirSync, writeFileSync: write } = await import('node:fs')
  const d = path.join(dir, 'set-aside')
  mk(d, { recursive: true })
  write(path.join(d, 'X.server.json'), '{"stale":true}')
  write(path.join(d, 'X.config.json'), '{}')
  write(path.join(d, 'Y.server.json'), '{}')
  setAside(d, 'X')
  expect(existsSync(path.join(d, 'X.server.json'))).toBe(false)
  const [moved] = readdirSync(path.join(d, 'interrupted'))
  expect(readdirSync(path.join(d, 'interrupted', moved!)).toSorted()).toEqual([
    'X.config.json',
    'X.server.json',
  ])
  // another trial's files are untouched
  expect(existsSync(path.join(d, 'Y.server.json'))).toBe(true)
})

test(
  'a resumed run re-runs a trial with a cut-off trace, and never scores a stale server record',
  { timeout: 300_000 },
  async () => {
    const { execFileSync } = await import('node:child_process')
    const {
      readdirSync,
      readFileSync: read,
      writeFileSync: write,
      mkdirSync: mk,
    } = await import('node:fs')
    const d = path.join(dir, 'resume')
    mk(d, { recursive: true })
    // a trace cut off mid-write, and a stale server record from a killed attempt
    write(path.join(d, 'dry-A.jsonl'), '{"kind":"trial"')
    write(path.join(d, 'dry-B.server.json'), JSON.stringify({ stale: true }))
    execFileSync(process.execPath, [path.resolve(import.meta.dirname, '../src/run.ts'), 'dry', d], {
      stdio: 'pipe',
    })
    const set = readdirSync(path.join(d, 'interrupted'))
    expect(set.some((s) => s.startsWith('dry-A-'))).toBe(true)
    expect(set.some((s) => s.startsWith('dry-B-'))).toBe(true)
    // both ran in full: their traces are complete, and B's server record is its own
    for (const id of ['dry-A', 'dry-B']) {
      const kinds = read(path.join(d, `${id}.jsonl`), 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l).kind)
      expect(kinds.at(-1)).toBe('metrics')
    }
    expect(JSON.parse(read(path.join(d, 'dry-B.server.json'), 'utf8')).stale).toBeUndefined()
  },
)

// boundary review #8, intake's ruling (2026-11-18 12:05Z): a cap is only the CLI's own signal; a crash or a 529 is
// set aside and rerun once, then scored failed; an auth failure is never retried, and stops the run
const spec = (id: string) =>
  ({ id, condition: 'A', task: 'T3', model: 'none', driver: 'fake', index: 1 }) as const
// the fake driver's real run, then the CLI's ending replaced
let raws = 0
const ending = (patch: Partial<DriverResult>) => {
  const fake = fakeDriver(1, path.join(dir, `ending-${raws++}.raw.json`))
  return {
    ...fake,
    run: async (t: Trial) => ({ ...(await fake.run(t)), finalText: '', exitCode: 1, ...patch }),
  }
}
const thrown = (p: Promise<unknown>) =>
  p.then(
    () => undefined,
    (e: unknown) => e,
  )

// a CLI that exited nonzero with no final text, as the driver would report it
const exited = (patch: Partial<DriverResult>) =>
  ({ exitCode: 1, finalText: '', ...patch }) as DriverResult

describe('driver failures, by class', () => {
  test('the classes, from the CLI’s exit and its own error text', () => {
    expect(failureOf(exited({ stopped: 'turns' }))).toBeUndefined()
    expect(failureOf(exited({ exitCode: 124 }))).toBeUndefined()
    expect(failureOf(exited({ exitCode: 0 }))).toBeUndefined()
    expect(failureOf(exited({ error: 'Segmentation fault' }))?.kind).toBe('crash')
    expect(failureOf(exited({}))?.kind).toBe('crash')
    expect(failureOf(exited({ error: 'API Error: 529 {"type":"overloaded_error"}' }))?.kind).toBe(
      'overloaded',
    )
    expect(failureOf(exited({ error: 'Invalid API key · Please run /login' }))?.kind).toBe('auth')
    expect(failureOf(exited({ error: 'API Error: 401 authentication_error' }))?.kind).toBe('auth')
    // stderr, and a thrown message, never class a failure: they can echo tool output, and the benchmark's refusals say
    // unauthorized (review of 006e2902)
    expect(
      failureOf(exited({ stderr: 'tool said: {"code":"unauthorized"}, 529 overloaded' }))?.kind,
    ).toBe('crash')
    expect(failureOf(undefined, 'spawn failed: unauthorized 401')?.kind).toBe('crash')
  })

  test('a cap signal: capped at turns, scored, never a driver failure', async () => {
    const r = await runTrial(spec('cap-A'), ending({ stopped: 'turns' }), dir)
    expect([r.end, r.capHits]).toEqual(['capped', ['turns']])
  })

  test.each([
    ['a crash', 'crash', { error: 'Segmentation fault' }],
    ['a 529', 'overloaded', { error: 'API Error: 529 Overloaded' }],
  ] as const)(
    '%s: set aside in interrupted/ and thrown, then on the rerun scored failed, not optimal',
    async (_, kind, patch) => {
      const id = `${kind}-A`
      const first = await thrown(runTrial(spec(id), ending(patch), dir))
      expect(first).toBeInstanceOf(DriverFailure)
      expect((first as DriverFailure).kind).toBe(kind)
      // no complete trace, so the resume reruns it; the attempt is kept in interrupted/
      expect(existsSync(path.join(dir, `${id}.jsonl`))).toBe(false)
      expect(priorFailures(dir, id)).toBe(1)
      const second = await runTrial(spec(id), ending(patch), dir)
      expect([second.end, second.metrics.optimal]).toEqual(['failed', false])
      const end = readFileSync(path.join(dir, `${id}.jsonl`), 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l))
        .find((l) => l.kind === 'end')
      expect(end).toMatchObject({ end: 'failed', attempts: 2, driverFailure: { kind } })
    },
  )

  test('an auth failure is thrown every time, never scored or retried into a result', async () => {
    const auth = { error: 'Invalid API key · Please run /login' }
    for (let i = 0; i < 2; i++) {
      const e = await thrown(runTrial(spec('auth-A'), ending(auth), dir))
      expect((e as DriverFailure).kind).toBe('auth')
    }
    expect(existsSync(path.join(dir, 'auth-A.jsonl'))).toBe(false)
  })

  test('a resume pauses when more than 5% of specs failed and await their rerun', () => {
    const plan = Array.from({ length: 40 }, (_, i) => spec(`p${i}`)) as unknown as TrialSpec[]
    const at = mkdtempSync(path.join(dir, 'pause-'))
    const fail = (id: string) => {
      const d = path.join(at, 'interrupted', `${id}-x`)
      mkdirSync(d, { recursive: true })
      writeFileSync(path.join(d, `${id}.failure.json`), '{}')
    }
    // 5% of 40 is 2: two failed specs proceed, a third pauses
    fail('p0')
    fail('p1')
    expect(pauseFor(at, plan)).toBeUndefined()
    fail('p2')
    expect(pauseFor(at, plan)).toMatch(/3 specs failed .* more than 5% \(2\): tell intake/)
    // a failed spec whose rerun completed no longer counts
    writeFileSync(path.join(at, 'p2.jsonl'), '{}\n')
    expect(pauseFor(at, plan)).toBeUndefined()
  })
})

// boundary review #9: a plan is gated on the logins its drivers use, so a Claude-only plan runs without Codex's
test('a run needs only the logins its plan’s drivers use', () => {
  const claudeOnly = [{ ...spec('c'), driver: 'claude-cli' }] as unknown as TrialSpec[]
  const both = pilotPlan()
  expect(missingLogins({ claude: true, codex: false }, claudeOnly)).toEqual([])
  expect(missingLogins({ claude: false, codex: true }, claudeOnly)).toEqual(['claude'])
  expect(missingLogins({ claude: true, codex: false }, both)).toEqual(['codex'])
  expect(missingLogins({ claude: false, codex: false }, both)).toEqual(['claude', 'codex'])
  // a dry run's fake driver needs no login
  expect(
    missingLogins({ claude: false, codex: false }, [spec('f')] as unknown as TrialSpec[]),
  ).toEqual([])
})

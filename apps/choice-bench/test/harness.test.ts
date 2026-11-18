import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as lab from '@affordances/hosting-lab/trial'
import { afterAll, expect, test } from 'vitest'
import { fakeDriver } from '../src/drivers/fake.ts'
import { pilotPlan, promptFor, runTrial, INSTRUCTIONS } from '../src/harness.ts'
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

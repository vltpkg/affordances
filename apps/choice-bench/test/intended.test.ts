import * as lab from '@affordances/hosting-lab/trial'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, expect, test } from 'vitest'
import { conditions } from '../src/conditions.ts'
import { intendedEndState, intendedEndStates } from '../src/intended.ts'
import type { ServerRecord } from '../src/server.ts'
import { createTools } from '../src/tools.ts'
import { setupTrial } from '../src/trial.ts'

// the planner's test of the choice rule (2026-11-18): for every path a trial can take through the catalog, the
// replayed intended end state equals the real one after approving each step, and replaying touches nothing of the
// trial's own

const dir = mkdtempSync(path.join(tmpdir(), 'choice-bench-intended-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const T3 = lab.tasks.find((t) => t.id === 'T3')!

type Step = {
  offer: (plans: readonly string[], project: string) => string
  input?: Record<string, unknown>
}
const plan = (slug: 'hobby' | 'pro' | 'business'): Step => ({
  offer: (plans, project) =>
    `hosting.plan.subscribe@hosting.plan:${plans[['hobby', 'pro', 'business'].indexOf(slug)]}?project=${project}`,
})
const STEPS: Record<string, Step> = {
  hobby: plan('hobby'),
  pro: plan('pro'),
  business: plan('business'),
  bundle: { offer: (_, p) => `hosting.bundle.subscribe@hosting.bundle:pro-plus?project=${p}` },
  cancel: { offer: (_, p) => `hosting.subscription.cancel@hosting.project:${p}` },
  ...Object.fromEntries(
    ['priority-support', 'extra-bandwidth', 'daily-backups'].flatMap((a) => [
      [
        `+${a}`,
        {
          offer: (_: unknown, p: string) => `hosting.addOn.add@hosting.project:${p}`,
          input: { addOn: a },
        },
      ],
      [
        `-${a}`,
        {
          offer: (_: unknown, p: string) => `hosting.addOn.remove@hosting.project:${p}`,
          input: { addOn: a },
        },
      ],
    ]),
  ),
}
const PLANS = new Set(['hobby', 'pro', 'business'])

// a path run for real, each step approved, as the trial's tools run it
const runPath = async (names: string[], index: number) => {
  const condition = conditions.A
  const trial = await setupTrial(condition, index)
  const tools = createTools(trial, condition, T3)
  for (const name of names) {
    const step = STEPS[name]!
    const offer = step.offer(trial.plans, trial.project.key)
    const first = JSON.parse((await tools.call('execute', { offer, input: step.input })).text)
    if (first.code === 'confirmation_required')
      await tools.call('execute', {
        offer,
        input: step.input,
        approval: first.confirmation.approval,
      })
  }
  const record: ServerRecord = {
    condition: 'A',
    task: 'T3',
    index,
    plans: trial.plans,
    project: trial.project.key,
    manifestDigest: '',
    calls: tools.calls,
    exposures: [],
    approvals: tools.approvals,
    capped: false,
    endState: lab.endState(trial.sid),
  }
  const file = path.join(dir, `${names.join(',') || 'empty'}-${index}.json`)
  writeFileSync(file, JSON.stringify(record))
  return { file, real: record.endState }
}

// every path of up to two steps, and every three-step path through cancel, with at most one plan (one choice set):
// a second plan is a switch, which the rule doesn't replay
const names = Object.keys(STEPS)
const paths = [
  ...names.map((a) => [a]),
  ...names.flatMap((a) => names.map((b) => [a, b])),
  ...names.flatMap((a) =>
    names.flatMap((b) => [
      ['cancel', a, b],
      [a, 'cancel', b],
      [a, b, 'cancel'],
    ]),
  ),
].filter((p) => p.filter((n) => PLANS.has(n)).length <= 1)

test(
  `the replayed end state equals the real one on ${paths.length} catalog paths`,
  { timeout: 600_000 },
  async () => {
    const runs = []
    // the plan-id order changes with the index, so the replay must follow it
    for (const [i, p] of paths.entries()) runs.push({ path: p, ...(await runPath(p, i)) })
    const replays = await intendedEndStates(runs.map((r) => r.file))
    const differ = runs.flatMap((r, i) =>
      JSON.stringify(replays[i]!.state) === JSON.stringify(r.real)
        ? []
        : [{ path: r.path, real: r.real, replayed: replays[i]!.state }],
    )
    expect(differ).toEqual([])
    expect(replays.every((r) => r.skipped.length === 0)).toBe(true)
  },
)

test('a second plan is a switch: the first is replayed, the second skipped', async () => {
  const { file } = await runPath(['pro', 'business'], 0)
  const r = await intendedEndState(file)
  expect(r.state).toEqual({ plan: 'pro', bundle: null, addOns: [] })
  expect(r.skipped).toEqual([expect.stringMatching(/^hosting\.plan\.subscribe@/)])
})

test('an offer only brought to confirmation, never approved, still counts toward the intended state', async () => {
  const condition = conditions.A
  const trial = await setupTrial(condition, 0)
  const tools = createTools(trial, condition, T3)
  await tools.call('execute', { offer: STEPS.bundle!.offer(trial.plans, trial.project.key) })
  const record = {
    condition: 'A',
    task: 'T3',
    index: 0,
    plans: trial.plans,
    project: trial.project.key,
    manifestDigest: '',
    calls: tools.calls,
    exposures: [],
    approvals: tools.approvals,
    capped: false,
    endState: lab.endState(trial.sid),
  } satisfies ServerRecord
  const file = path.join(dir, 'asked.json')
  writeFileSync(file, JSON.stringify(record))
  expect(record.endState.plan).toBe('hobby')
  const { state } = await intendedEndState(file)
  // the app's end state lists the bundle's included add-on; the label is the bundle's
  expect(state).toEqual({ plan: 'pro', bundle: 'pro-plus', addOns: ['priority-support'] })
  expect(lab.label(state!)).toBe('pro-plus')
})

test('scoring leaves the trial’s store, ledger and tokens untouched', async () => {
  const condition = conditions.A
  const trial = await setupTrial(condition, 0)
  const tools = createTools(trial, condition, T3)
  const offer = STEPS.pro!.offer(trial.plans, trial.project.key)
  // the trial ran Pro, and holds an unused approval for the bundle
  const first = JSON.parse((await tools.call('execute', { offer })).text)
  await tools.call('execute', { offer, approval: first.confirmation.approval })
  const bundleOffer = STEPS.bundle!.offer(trial.plans, trial.project.key)
  const pending = JSON.parse((await tools.call('execute', { offer: bundleOffer })).text)
  const before = JSON.stringify(lab.account(trial.sid))
  const record = {
    condition: 'A',
    task: 'T3',
    index: 0,
    plans: trial.plans,
    project: trial.project.key,
    manifestDigest: '',
    calls: tools.calls,
    exposures: [],
    approvals: tools.approvals,
    capped: false,
    endState: lab.endState(trial.sid),
  } satisfies ServerRecord
  const file = path.join(dir, 'isolation.json')
  writeFileSync(file, JSON.stringify(record))
  await intendedEndState(file)
  // the store and its ledger are byte-equal
  expect(JSON.stringify(lab.account(trial.sid))).toBe(before)
  // no token was consumed: the trial's pending approval still runs, once; and the spent one stays spent
  const used = await trial.runtime.execute({
    principal: trial.principal,
    offer: bundleOffer,
    approval: pending.confirmation.approval,
  })
  expect(used.status).toBe('succeeded')
  const again = await trial.runtime.execute({
    principal: trial.principal,
    offer,
    approval: first.confirmation.approval,
  })
  expect(again).toMatchObject({ status: 'refused' })
})

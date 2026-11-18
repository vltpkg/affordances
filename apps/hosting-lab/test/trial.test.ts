import { createRuntime } from '@affordances/runtime'
import { beforeEach, expect, test } from 'vitest'
import * as trial from '../src/trial.ts'

// the harness's entry point: a trial built from it alone, as a plain node process would

beforeEach(() => trial.reset())

const approvalKey = () =>
  crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]) as Promise<CryptoKey>

test('a trial projects the permuted plan ids, and executes the same assignment', async () => {
  trial.setPlanIds(['p3', 'p1', 'p2'])
  const runtime = createRuntime({
    manifest: trial.manifest,
    resources: trial.resolvers,
    handlers: trial.handlers,
    approvalKeys: { current: await approvalKey() },
    seenTokens: trial.memoryTokens(),
  })
  const sid = 's_trial'
  // the trial's account is made up front: reads never make one
  const { project } = trial.account(sid)
  const projection = await runtime.project({ principal: trial.principalFor(sid) })
  const set = projection.choiceSets.find((c) => c.capability === 'hosting.plan.subscribe')!
  // canonical order is by id: p1 is now Pro, p2 Business, p3 Hobby
  expect(set.members).toEqual([
    'hosting.plan.subscribe@hosting.plan:p1',
    'hosting.plan.subscribe@hosting.plan:p2',
    'hosting.plan.subscribe@hosting.plan:p3',
  ])
  const p1 = projection.offers.find((o) => o.id === 'hosting.plan.subscribe@hosting.plan:p1')!
  expect(p1.claims.map((c) => c.id)).toContain('proRecommended')
  // executing p1 through the runtime, approved as the simulated user approves (RFC 0003 §5.2), moves to Pro
  const call = {
    principal: trial.principalFor(sid),
    offer: `hosting.plan.subscribe@hosting.plan:p1?project=${project.id}`,
    input: { plan: 'p1', projectId: project.id },
  }
  const refused = await runtime.execute(call)
  expect(refused).toMatchObject({ status: 'refused', code: 'confirmation_required' })
  const approval = refused.status === 'refused' ? refused.confirmation?.approval : undefined
  expect(await runtime.execute({ ...call, approval })).toMatchObject({ status: 'succeeded' })
  expect(trial.endState(sid)).toEqual({ plan: 'pro', bundle: null, addOns: [] })
  expect(trial.label(trial.endState(sid))).toBe('pro')
})

test('the trial entry point loads no Next.js module', async () => {
  const { readFileSync } = await import('node:fs')
  const sources = [
    'trial.ts',
    'manifest.ts',
    'catalog.ts',
    'tasks.ts',
    'structure.ts',
    'lib/resolvers.ts',
    'lib/store.ts',
    'lib/guards.ts',
    'lib/handlers.ts',
  ]
  for (const file of sources)
    expect(readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')).not.toMatch(
      /from 'next/,
    )
})

test("condition G: the runtime's subscribe handler applies the add-ons its manifest edit sends", async () => {
  const sid = 's_g'
  const { id } = trial.account(sid).project
  await trial.handlers['hosting.plan.subscribe']!.run!(
    { plan: 'p2', projectId: id, addOns: ['priority-support'] },
    { principal: trial.principalFor(sid), refs: {} },
  )
  expect(trial.endState(sid)).toEqual({ plan: 'pro', bundle: null, addOns: ['priority-support'] })
  // and the overspend metric's predicate is there for the harness (RFC 0003 §6)
  expect(typeof trial.satisfies).toBe('function')
})

// every request a trial could make, on its project
const ops = (projectId: string) => [
  ...['p1', 'p2', 'p3'].map((plan) => ({
    offer: 'hosting.plan.subscribe',
    input: { plan, projectId },
    choiceSet: 'plans',
  })),
  { offer: 'hosting.bundle.subscribe', input: { bundle: 'pro-plus', projectId } },
  { offer: 'hosting.addOn.add', input: { addOn: 'priority-support', projectId } },
  { offer: 'hosting.addOn.remove', input: { addOn: 'priority-support', projectId } },
  { offer: 'hosting.subscription.cancel', input: { projectId } },
]

// RFC 0003 §5.2: the choice is the intended end state, a dry run of the trial's requests. For every path a trial
// could take, the dry run's end state is the real one after approving each step it applied
test('the dry run of every request path ends where approving each step really does', async () => {
  const key = await approvalKey()
  const paths: number[][] = []
  for (let n = 1; n <= 3; n++) {
    const walk = (prefix: number[]) => {
      if (prefix.length === n) return paths.push(prefix)
      for (let i = 0; i < 7; i++) walk([...prefix, i])
    }
    walk([])
  }
  let switched = 0
  for (const path of paths) {
    trial.reset()
    const sid = 's_path'
    const { id } = trial.account(sid).project
    const requests = path.map((i) => ops(id)[i]!)
    const dry = await trial.intendedEndState(sid, requests)
    // the dry run leaves the real store as it was: its state, its ledger, its accounts
    expect(trial.endState(sid)).toEqual({ plan: 'hobby', bundle: null, addOns: [] })
    expect(trial.account(sid).ledger).toEqual([])
    expect(trial.account(sid).project.deployments.size).toBe(0)
    if (dry.switched) switched++
    const runtime = createRuntime({
      manifest: trial.manifest,
      resources: trial.resolvers,
      handlers: trial.handlers,
      approvalKeys: { current: key },
      seenTokens: trial.memoryTokens(),
    })
    for (const r of dry.applied) {
      const call = { principal: trial.principalFor(sid), offer: r.offer, input: r.input }
      const first = await runtime.execute(call)
      if (first.status === 'refused' && first.code === 'confirmation_required')
        await runtime.execute({ ...call, approval: first.confirmation!.approval })
    }
    // which path, if this fails
    expect({ path: path.join(','), state: trial.endState(sid) }).toEqual({
      path: path.join(','),
      state: dry.state,
    })
    expect(dry.choice).toBe(trial.label(dry.state!))
  }
  expect(paths).toHaveLength(7 + 49 + 343)
  // some paths ask for two plans: those are switching, and only the first plan is applied
  expect(switched).toBeGreaterThan(0)
  expect(await trial.intendedEndState('s_none', [])).toEqual({
    choice: 'none',
    switched: false,
    applied: [],
  })
}, 60_000)

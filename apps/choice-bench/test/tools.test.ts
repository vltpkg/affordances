import * as lab from '@affordances/hosting-lab/trial'
import { expect, test } from 'vitest'
import { conditions, type ConditionId } from '../src/conditions.ts'
import { createTools, MAX_CALLS, render, TOOLS } from '../src/tools.ts'
import { setupTrial } from '../src/trial.ts'

const T1 = lab.tasks.find((t) => t.id === 'T1')!
const T3 = lab.tasks.find((t) => t.id === 'T3')!
const open = async (id: ConditionId, task = T1, index = 0) => {
  const trial = await setupTrial(conditions[id], index)
  return { trial, tools: createTools(trial, conditions[id], task) }
}
const json = (text: string) => JSON.parse(text) as Record<string, any>

test('the tools are one fixed set: no condition passes a policy, and the agent can’t either', () => {
  expect(Object.keys(TOOLS)).toEqual(['project', 'expand', 'inspect', 'execute'])
  for (const t of Object.values(TOOLS)) expect(Object.keys(t.inputSchema)).not.toContain('policy')
})

test('a response is the RFC 8785 order, two-space indented', () => {
  expect(render({ b: 1, a: [{ d: 1, c: 2 }] })).toBe(
    '{\n  "a": [\n    {\n      "c": 2,\n      "d": 1\n    }\n  ],\n  "b": 1\n}',
  )
})

test('T1 under A, as an agent does it: project, execute Pro, approved, and the end state is Pro', async () => {
  const { trial, tools } = await open('A')
  const view = json((await tools.call('project')).text)
  const pro = view.offers.find(
    (o: any) => o.capability === 'hosting.plan.subscribe' && o.target.key === trial.plans[1],
  )
  // the second id of the order is Pro's (catalog order: hobby, pro, business)
  const refused = json((await tools.call('execute', { offer: pro.id })).text)
  expect(refused).toMatchObject({
    status: 'refused',
    code: 'confirmation_required',
    userApproved: true,
  })
  const done = json(
    (await tools.call('execute', { offer: pro.id, approval: refused.confirmation.approval })).text,
  )
  expect(done.status).toBe('succeeded')
  expect(lab.endState(trial.sid)).toEqual({ plan: 'pro', bundle: null, addOns: [] })
  expect(tools.approvals).toEqual([
    { call: 2, offer: pro.id, summary: refused.confirmation.summary },
  ])
  expect(tools.calls.map((c) => c.tool)).toEqual(['project', 'execute', 'execute'])
})

test('after an execution, the next project is a fresh projection of the new state', async () => {
  const { trial, tools } = await open('A')
  const before = json((await tools.call('project')).text)
  const pro = before.offers.find(
    (o: any) => o.capability === 'hosting.plan.subscribe' && o.target.key === trial.plans[1],
  )
  const refused = json((await tools.call('execute', { offer: pro.id })).text)
  await tools.call('execute', { offer: pro.id, approval: refused.confirmation.approval })
  const after = json((await tools.call('project')).text)
  expect(after.revision).not.toBe(before.revision)
})

test('claims omitted in A’s view are exposed by inspect, and logged by route', async () => {
  const { tools } = await open('A')
  const view = json((await tools.call('project')).text)
  expect(view.offers.every((o: any) => o.claims.length === 0)).toBe(true)
  expect(view.omitted.claims).toBeGreaterThan(0)
  for (const o of view.offers) await tools.call('inspect', { offer: o.id })
  expect(tools.exposures.length).toBeGreaterThan(0)
  expect(new Set(tools.exposures.map((e) => e.route))).toEqual(new Set(['inspect']))
})

test('C shows the claims in its view, and logs them as view exposures', async () => {
  const { tools } = await open('C')
  await tools.call('project')
  expect(tools.exposures.some((e) => e.route === 'view' && e.call === 1)).toBe(true)
})

test('S nests every choice set’s members, carrying exactly A’s information', async () => {
  const { trial, tools } = await open('S', T3)
  const s = json((await tools.call('project')).text)
  // A's view of the same trial: S's policy is A's
  const projection = await trial.runtime.project({
    principal: trial.principal,
    ...trial.request,
    task: { statement: T3.text },
  })
  const a = json(render(projection.view()))
  expect(s.choiceSets.length).toBeGreaterThan(0)
  for (const c of s.choiceSets) expect(typeof c.members[0]).toBe('object')
  expect(lab.sameInformation(a as never, s as never)).toBe(true)
})

test('an unknown offer is an error response, recorded, and the trial goes on', async () => {
  const { tools } = await open('A')
  const r = await tools.call('inspect', { offer: 'hosting.nothing' })
  expect(r.error).toBe(true)
  expect(tools.calls[0]).toMatchObject({ tool: 'inspect', error: true })
  expect((await tools.call('project')).error).toBeUndefined()
})

test(`the ${MAX_CALLS + 1}st call is refused, and the trial is capped`, async () => {
  const { tools } = await open('A')
  for (let i = 0; i < MAX_CALLS; i++) await tools.call('project')
  expect(tools.capped).toBe(false)
  expect((await tools.call('project')).error).toBe(true)
  expect(tools.capped).toBe(true)
})

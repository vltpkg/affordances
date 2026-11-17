import { createAffordances, createHandler } from '@affordances/core'
import { beforeEach, expect, test } from 'vitest'
import { serveExecute } from '../src/lib/serve.ts'
import { checkedBy } from '../src/lib/runtime.ts'
import * as store from '../src/lib/store.ts'
import { cancel, subscribe } from '../src/manifest.ts'

// v0's media type (packages/protocol): hosting-lab doesn't depend on the protocol package itself
const MEDIA_TYPE = 'application/vnd.affordances+json'
type Delta = { ok: boolean; error?: { code: string; message: string } }

beforeEach(() => store.reset())

const execute = (body: unknown, sid?: string) =>
  serveExecute(
    new Request('https://hosting.test/api/projection/execute', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
        ...(sid && { authorization: `Bearer ${sid}` }),
      },
    }),
  )

test('a consequential call is refused with its summary and a token, runs once with it, and never twice', async () => {
  const { id } = store.account('s_exec').project
  const offer = `hosting.plan.subscribe@hosting.plan:p2?project=${id}`
  const call = { offer, input: { plan: 'p2', projectId: id } }
  const first = await execute(call, 's_exec')
  expect(first.status).toBe(409)
  const refused = await first.json()
  expect(refused).toMatchObject({ status: 'refused', code: 'confirmation_required' })
  expect(refused.confirmation.summary).toContain('USD a month')
  expect(store.account('s_exec').project.plan).toBe('hobby')

  const approved = await execute({ ...call, approval: refused.confirmation.approval }, 's_exec')
  expect(approved.status).toBe(200)
  expect(await approved.json()).toMatchObject({ status: 'succeeded' })
  expect(store.account('s_exec').project.plan).toBe('pro')

  // the same token again: it has run
  const replay = await execute({ ...call, approval: refused.confirmation.approval }, 's_exec')
  expect(replay.status).not.toBe(200)
  // and another session can't use it
  store.account('s_thief')
  expect(
    (await execute({ ...call, approval: refused.confirmation.approval }, 's_thief')).status,
  ).not.toBe(200)
})

test('a precondition refuses with its condition; unknown offers and bad bodies are refused', async () => {
  const { id } = store.account('s_pre').project
  const response = await execute(
    { offer: `hosting.subscription.cancel@hosting.project:${id}`, input: { projectId: id } },
    's_pre',
  )
  expect(response.status).toBe(409)
  expect(await response.json()).toMatchObject({
    code: 'precondition',
    condition: { id: 'paid', description: 'The project renews on a paid plan' },
  })
  expect((await execute({ offer: 'hosting.nothing@x:y' }, 's_pre')).status).toBe(404)
  expect((await execute({ input: {} }, 's_pre')).status).toBe(400)
  expect((await execute({ offer: 'hosting.plan.list', approval: 7 }, 's_pre')).status).toBe(400)
  // without credentials, nothing per-project runs, and no account is made
  expect(
    (
      await execute({
        offer: `hosting.subscription.cancel@hosting.project:proj_s_nobody`,
        input: { projectId: 'proj_s_nobody' },
      })
    ).status,
  ).not.toBe(200)
  expect(store.findAccount('s_nobody')).toBeUndefined()
})

// v0's agent path, checked by the app's real runtime (RFC 0001 §12.1), through core's handler without Next.js
const { defineAction, defineState } = createAffordances<{ id: string }>({
  auth: (request) => {
    const id = request.headers.get('authorization')?.replace('Bearer ', '')
    return id ? { id } : null
  },
})
const overview = defineState(() => ({}))
const v0Cancel = defineAction({
  capability: cancel,
  name: 'cancel',
  state: overview,
  ...checkedBy,
  run: ({ projectId }, ctx) => store.cancel(ctx.session!.id, projectId),
})
const v0Subscribe = defineAction({
  capability: subscribe,
  name: 'subscribe',
  state: overview,
  ...checkedBy,
  run: ({ plan, projectId }, ctx) => store.subscribePlan(ctx.session!.id, projectId, plan),
})
const handler = createHandler({
  manifest: {
    name: 'hosting-lab',
    routes: { '/': { state: overview, actions: [v0Cancel, v0Subscribe] } },
  },
  basePath: '/api/affordances',
})
const v0 = async (body: unknown, sid: string) => {
  const response = await handler(
    new Request('https://hosting.test/api/affordances/', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': MEDIA_TYPE, authorization: `Bearer ${sid}` },
    }),
  )
  return { status: response.status, delta: (await response.json()) as Delta }
}

test("v0's agent path: refused while the condition is false, and runs once it's true", async () => {
  const { id } = store.account('s_v0').project
  const refused = await v0({ action: 'cancel', input: { projectId: id } }, 's_v0')
  expect(refused.delta).toMatchObject({
    ok: false,
    error: { code: 'unavailable', message: expect.stringContaining('paid plan') },
  })
  expect(store.account('s_v0').project.renewsAs).toBe('hobby')
  store.subscribePlan('s_v0', id, 'p2')
  expect((await v0({ action: 'cancel', input: { projectId: id } }, 's_v0')).delta).toMatchObject({
    ok: true,
  })
  expect(store.account('s_v0').project.renewsAs).toBe('hobby')
})

test("v0's agent path: without confirm, v0's own confirm_required with the runtime's summary; with it, it runs", async () => {
  const { id } = store.account('s_v0c').project
  const input = { plan: 'p2', projectId: id }
  const unconfirmed = await v0({ action: 'subscribe', input }, 's_v0c')
  expect(unconfirmed.status).toBe(409)
  expect(unconfirmed.delta).toMatchObject({
    ok: false,
    // the runtime fills the summary from the target, which v0's own template couldn't
    error: { code: 'confirm_required', message: expect.stringMatching(/Pro, for \d+ USD a month/) },
  })
  expect(store.account('s_v0c').project.plan).toBe('hobby')
  expect((await v0({ action: 'subscribe', input, confirm: true }, 's_v0c')).delta).toMatchObject({
    ok: true,
  })
  expect(store.account('s_v0c').project.plan).toBe('pro')
})

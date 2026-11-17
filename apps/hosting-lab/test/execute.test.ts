import { createAffordances, createHandler } from '@affordances/core'
import { beforeEach, expect, test } from 'vitest'
import { serveExecute, serveExpand, serveView } from '../src/lib/serve.ts'
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

  const approved = await execute(
    { ...call, approval: refused.confirmation.approval, start: `hosting.project:${id}` },
    's_exec',
  )
  expect(approved.status).toBe(200)
  const succeeded = await approved.json()
  expect(succeeded).toMatchObject({ status: 'succeeded' })
  // what changed, compared with the caller's view from the project (RFC 0002 §8.3)
  expect(succeeded.changes).toBeDefined()
  expect(succeeded.revision).toMatch(/^sha256-/)
  expect(store.account('s_exec').project.plan).toBe('pro')

  // the same token again: it has run
  const replay = await execute({ ...call, approval: refused.confirmation.approval }, 's_exec')
  expect(replay.status).not.toBe(200)
  // and another session can't use it
  store.account('s_thief')
  expect(
    (await execute({ ...call, approval: refused.confirmation.approval }, 's_thief')).status,
  ).not.toBe(200)
  expect((await execute({ ...call, start: 7 }, 's_exec')).status).toBe(400)
  expect((await execute({ ...call, policy: 'secret' }, 's_exec')).status).toBe(400)
  expect((await execute({ ...call, offers: 0 }, 's_exec')).status).toBe(400)
})

const ids = (v: { offers: { id: string }[] }) => new Set(v.offers.map((o) => o.id))

test("an execution's changes are the caller's view's, under its policy and budget", async () => {
  // cancelling makes the cancel offer unavailable. The project's whole view shows that; a two-offer view, which
  // doesn't hold the cancel offer, reports nothing it didn't show
  for (const [sid, offers, expected] of [
    ['s_chg_all', undefined, [true]],
    ['s_chg_two', 2, []],
  ] as const) {
    const { id } = store.account(sid).project
    store.subscribePlan(sid, id, 'p2')
    const cancelOffer = `hosting.subscription.cancel@hosting.project:${id}`
    const view = `?start=hosting.project:${id}&policy=resource${offers ? `&offers=${offers}` : ''}`
    const read = async (): Promise<{ offers: { id: string }[] }> =>
      (
        await serveView(
          new Request(`https://hosting.test/api/projection${view}`, {
            headers: { authorization: `Bearer ${sid}` },
          }),
        )
      ).json()
    const before = await read()
    const result = await (
      await execute(
        {
          offer: cancelOffer,
          input: { projectId: id },
          start: `hosting.project:${id}`,
          policy: 'resource',
          ...(offers && { offers }),
        },
        sid,
      )
    ).json()
    expect(result).toMatchObject({ status: 'succeeded' })
    const after = await read()
    const shown = new Set([...ids(before), ...ids(after)])
    const { added, removed, changed } = result.changes as {
      added: { id: string }[]
      removed: string[]
      changed: { id: string }[]
    }
    // every offer in changes is one the caller's view shows, before or after: changes never widen a view
    for (const o of added) expect(ids(after)).toContain(o.id)
    for (const r of removed) expect(ids(before)).toContain(r)
    for (const c of changed) expect(shown).toContain(c.id)
    expect(changed.filter((c) => c.id === cancelOffer).map(() => true)).toEqual(expected)
  }
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

// bearer calls need no Origin: every other test here sends one without
test('a cookie call needs a matching Origin, for execute and expand', async () => {
  const sid = 's_origin'
  const { id } = store.account(sid).project
  store.subscribePlan(sid, id, 'p2')
  const body = JSON.stringify({
    offer: `hosting.subscription.cancel@hosting.project:${id}`,
    input: { projectId: id },
  })
  const post = (headers: Record<string, string>) =>
    serveExecute(
      new Request('https://hosting.test/api/projection/execute', {
        method: 'POST',
        body,
        headers: { 'content-type': 'application/json', ...headers },
      }),
    )
  // a cross-site page, and a cookie call with no Origin at all, run nothing
  const crossSite: Record<string, string>[] = [
    { cookie: `sid=${sid}`, origin: 'https://evil.test' },
    { cookie: `sid=${sid}` },
  ]
  for (const headers of crossSite) expect((await post(headers)).status).toBe(403)
  const expand = await serveExpand(
    new Request('https://hosting.test/api/projection/expand', {
      method: 'POST',
      body: JSON.stringify({ from: { type: 'hosting.project', key: id }, along: 'relations' }),
      headers: {
        'content-type': 'application/json',
        cookie: `sid=${sid}`,
        origin: 'https://evil.test',
      },
    }),
  )
  expect(expand.status).toBe(403)
  expect(store.account(sid).project.renewsAs).not.toBe('hobby')
  // the site's own page runs it
  expect((await post({ cookie: `sid=${sid}`, origin: 'https://hosting.test' })).status).toBe(200)
  expect(store.account(sid).project.renewsAs).toBe('hobby')
})

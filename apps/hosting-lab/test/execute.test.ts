import { createAffordances, createHandler } from '@affordances/core'
import { offerId, parseOfferId } from '@affordances/runtime'
import { beforeEach, expect, test } from 'vitest'
import * as serve from '../src/lib/serve.ts'
import { checkedBy } from '../src/lib/runtime.ts'
import * as store from '../src/lib/store.ts'
import { cancel, subscribe } from '../src/app/capabilities.ts'

// v0's media type (packages/protocol): hosting-lab doesn't depend on the protocol package itself
const MEDIA_TYPE = 'application/vnd.affordances+json'
type Delta = { ok: boolean; error?: { code: string; message: string } }

beforeEach(() => store.reset())

const execute = (body: unknown, sid?: string) =>
  serve.POST(
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
    store.subscribePlan(store.account(sid).id, id, 'p2')
    const cancelOffer = `hosting.subscription.cancel@hosting.project:${id}`
    const view = `?start=hosting.project:${id}&policy=resource${offers ? `&offers=${offers}` : ''}`
    const read = async (): Promise<{ offers: { id: string }[] }> =>
      (
        await serve.GET(
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
  run: ({ projectId }, ctx) => store.cancel(store.account(ctx.session!.id).id, projectId),
})
const v0Subscribe = defineAction({
  capability: subscribe,
  name: 'subscribe',
  state: overview,
  ...checkedBy,
  run: ({ plan, projectId }, ctx) =>
    store.subscribePlan(store.account(ctx.session!.id).id, projectId, plan),
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
  store.subscribePlan(store.account('s_v0').id, id, 'p2')
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
  store.subscribePlan(store.account(sid).id, id, 'p2')
  const body = JSON.stringify({
    offer: `hosting.subscription.cancel@hosting.project:${id}`,
    input: { projectId: id },
  })
  const post = (headers: Record<string, string>) =>
    serve.POST(
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
    // an empty bearer authenticates nothing, so the cookie does, and the Origin rule applies
    { cookie: `sid=${sid}`, authorization: 'Bearer ' },
    { cookie: `sid=${sid}`, authorization: 'Bearer two words' },
  ]
  for (const headers of crossSite) expect((await post(headers)).status).toBe(403)
  const expand = await serve.POST(
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

test("v0's graph lists from the real runtime's projection: open unless settled", async () => {
  const sid = 's_list'
  store.account(sid)
  const response = await handler(
    new Request('https://hosting.test/api/affordances/', {
      headers: { accept: MEDIA_TYPE, authorization: `Bearer ${sid}` },
    }),
  )
  const { actions } = (await response.json()) as {
    actions: { name: string; available: boolean; reason?: string }[]
  }
  // subscribe's conditions read its project reference and input, so a start-less projection can't settle them:
  // open. Cancel's paid plan is settled on Hobby: closed, with the condition's description
  expect(actions.find((a) => a.name === 'subscribe')).toMatchObject({ available: true })
  expect(actions.find((a) => a.name === 'cancel')).toMatchObject({
    available: false,
    reason: 'The project renews on a paid plan',
  })
})

test('a generated key reaches the runtime as written: its own offer id parses back to it, and a call names it', async () => {
  const sid = 's_keys'
  store.account(sid)
  const alphabet = 'ab?&@:%=/~ 1é'
  const keys = Array.from({ length: 40 }, (_, i) =>
    Array.from(
      { length: 1 + (i % 7) },
      (__, j) => alphabet[(i * 5 + j * 3) % alphabet.length],
    ).join(''),
  )
  for (const key of keys) {
    const id = offerId({
      capability: 'hosting.subscription.cancel',
      target: { type: 'hosting.project', key },
    })
    expect(parseOfferId(id)?.target?.key).toBe(key)
    // through v0's agent path: a project that doesn't exist is not found under its own key, never misread
    const { delta } = await v0({ action: 'cancel', input: { projectId: key } }, sid)
    expect(delta.error?.message).toBe(`No hosting.project '${key}'`)
  }
})

// RFC 0004 §2.3's statuses, in HTTP's own meanings, through the route: runtime's statusOf (packages/runtime/test/
// http.test.ts holds its own, including the signed-in 403, which no route reaches here). Who isn't signed in gets
// 401 and a challenge; input that fails the schema is 422, and a body that isn't a call is 400
test('a caller who isn’t signed in is refused with 401 and a Bearer challenge', async () => {
  const { id } = store.account('s_owner').project
  const response = await execute({
    offer: `hosting.plan.subscribe@hosting.plan:p2?project=${id}`,
    input: { plan: 'p2', projectId: id },
  })
  expect(response.status).toBe(401)
  expect(response.headers.get('www-authenticate')).toBe('Bearer')
  expect(await response.json()).toMatchObject({ status: 'refused', code: 'unauthorized' })
})

test('input that fails the schema is 422, and a body that isn’t a call is 400', async () => {
  const { id } = store.account('s_input').project
  const bad = await execute(
    {
      offer: `hosting.plan.subscribe@hosting.plan:p2?project=${id}`,
      input: { plan: 7, projectId: id },
    },
    's_input',
  )
  expect(bad.status).toBe(422)
  expect(await bad.json()).toMatchObject({ code: 'invalid_input' })
  const notJson = await serve.POST(
    new Request('https://hosting.test/api/projection/execute', {
      method: 'POST',
      body: 'not json',
      headers: { 'content-type': 'application/json', authorization: 'Bearer s_input' },
    }),
  )
  expect(notJson.status).toBe(400)
  expect((await execute({ input: {} }, 's_input')).status).toBe(400)
})

// code review of M8 (#2): a call the store refuses after every check passed, such as approving the bundle the
// project already has, is the agent's to correct, so it's a refusal, never a 5xx a trial counts as a server error
test('a call the store refuses is a 409 refusal with its reason, not a failure', async () => {
  const { id } = store.account('s_refused').project
  store.subscribeBundle(store.account('s_refused').id, id, 'pro-plus')
  const call = {
    offer: `hosting.bundle.subscribe@hosting.bundle:pro-plus?project=${id}`,
    input: { bundle: 'pro-plus', projectId: id },
  }
  const first = await (await execute(call, 's_refused')).json()
  expect(first).toMatchObject({ status: 'refused', code: 'confirmation_required' })
  const approved = await execute({ ...call, approval: first.confirmation.approval }, 's_refused')
  expect(approved.status).toBe(409)
  expect(await approved.json()).toMatchObject({
    status: 'refused',
    code: 'precondition',
    detail: 'Pro Plus is already the plan',
  })
})

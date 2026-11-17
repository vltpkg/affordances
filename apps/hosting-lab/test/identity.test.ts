import { NextRequest } from 'next/server'
import { beforeEach, expect, test } from 'vitest'
import { credentialOf } from '../src/lib/principal.ts'
import { serveExecute, serveExpand, serveInspect, serveView } from '../src/lib/serve.ts'
import * as store from '../src/lib/store.ts'
import { accountFor } from '../src/lib/view.ts'
import { proxy } from '../src/proxy.ts'

// the code review's findings 1 to 4 (the M3 close-out): a session's credential is never its identity, the
// proxy never gives an agent-facing request a session, and reading never makes an account

beforeEach(() => store.reset())

const json = { 'content-type': 'application/json' }
const bearer = (sid: string) => ({ authorization: `Bearer ${sid}` })
const view = (sid: string, query = '?policy=exhaustive') =>
  serveView(new Request(`https://hosting.test/api/projection${query}`, { headers: bearer(sid) }))
const post = (path: string, sid: string, body: unknown) =>
  (path === 'expand' ? serveExpand : serveExecute)(
    new Request(`https://hosting.test/api/projection/${path}`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { ...json, ...bearer(sid) },
    }),
  )

// every agent-facing response a session can get, along the paths an agent takes
const responses = async (sid: string): Promise<string[]> => {
  const out: string[] = []
  const read = async (r: Response | Promise<Response>) => out.push(await (await r).text())
  const first = await (await view(sid)).json()
  out.push(JSON.stringify(first))
  for (const e of first.omitted.expand)
    await read(post('expand', sid, { ...e, policy: 'exhaustive' }))
  for (const o of first.offers as { id: string }[]) {
    await read(
      serveInspect(
        new Request(
          `https://hosting.test/api/projection/inspect?offer=${encodeURIComponent(o.id)}&policy=exhaustive`,
          { headers: bearer(sid) },
        ),
      ),
    )
  }
  const { id } = store.findAccount(sid)!.project
  const subscribe = {
    offer: `hosting.plan.subscribe@hosting.plan:p2?project=${id}`,
    input: { plan: 'p2', projectId: id },
  }
  const refused = await (await post('execute', sid, subscribe)).json()
  out.push(JSON.stringify(refused))
  await read(post('execute', sid, { ...subscribe, approval: refused.confirmation?.approval }))
  await read(post('execute', sid, { offer: 'hosting.project.read', input: {} }))
  await read(
    post('execute', sid, {
      offer: `hosting.subscription.cancel@hosting.project:${id}`,
      input: { projectId: id },
    }),
  )
  return out
}

test('finding 1: no agent-facing response carries the session credential or its prefix', async () => {
  // generated sessions, in the shapes the app makes (a uuid) and others an agent might send
  const sids = [
    crypto.randomUUID(),
    crypto.randomUUID(),
    `s_${crypto.randomUUID().slice(0, 12)}`,
    'abcdefgh-short',
  ]
  for (const sid of sids) {
    store.account(sid)
    const all = (await responses(sid)).join('\n')
    expect(all.length).toBeGreaterThan(1000)
    expect(all).not.toContain(sid)
    expect(all).not.toContain(sid.slice(0, 8))
  }
})

test("finding 1: an account's id and its project's are random, and never collide", () => {
  const accounts = Array.from({ length: 2000 }, (_, i) => store.account(`s_${i}`))
  expect(new Set(accounts.map((a) => a.id)).size).toBe(2000)
  expect(new Set(accounts.map((a) => a.project.id)).size).toBe(2000)
  for (const [i, a] of accounts.entries()) {
    expect(a.id).not.toContain(`s_${i}`)
    expect(a.project.ownerId).toBe(a.id)
  }
  // the same session always finds the same account
  expect(store.account('s_7').id).toBe(accounts[7]!.id)
})

test("finding 1: a credential that looks like someone's account id is just an unknown session", async () => {
  const victim = store.account('s_victim')
  expect(store.findAccount(victim.id)).toBeUndefined()
  const v = await (await view(victim.id)).json()
  expect(
    v.offers.some((o: { target?: { key: string } }) => o.target?.key === victim.project.id),
  ).toBe(false)
})

// the credential a request with these headers carries
const at = (headers: Record<string, string>) =>
  credentialOf(new Request('https://hosting.test/', { headers }))

test('finding 2: one parser says which credential authenticates a call', () => {
  expect(at({ authorization: 'Bearer s_1', cookie: 'sid=s_2' })).toEqual({
    session: 's_1',
    via: 'bearer',
  })
  // a bearer header that names no token authenticates nothing; the cookie does
  for (const authorization of ['Bearer ', 'Bearer a b', 'Basic s_1'])
    expect(at({ authorization, cookie: 'sid=s_2' })).toEqual({ session: 's_2', via: 'cookie' })
  expect(at({})).toEqual({ session: null, via: null })
})

test('finding 3: the proxy never gives an agent-facing request a session; pages still get one', async () => {
  for (const path of [
    '/api/projection',
    '/api/projection/expand',
    '/api/projection/execute',
    '/api/affordances/graph',
  ]) {
    const request = new NextRequest(`https://hosting.test${path}`)
    const response = proxy(request)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(request.cookies.has('sid')).toBe(false)
  }
  const page = proxy(new NextRequest('https://hosting.test/plans'))
  expect(page.headers.get('set-cookie')).toMatch(/^sid=/)
})

test('finding 3: a caller with no credential is anonymous, and a per-project offer needs authorization', async () => {
  store.account('s_owner')
  const v = await (
    await serveView(new Request('https://hosting.test/api/projection?policy=exhaustive'))
  ).json()
  const subscribe = v.offers.find(
    (o: { capability: string }) => o.capability === 'hosting.plan.subscribe',
  )
  expect(subscribe.availability.status).toBe('needs-authorization')
  expect(store.accountCount()).toBe(1)
})

test('finding 4: reading never makes an account, in a v0 state loader or a projection', async () => {
  const sprayed = Array.from({ length: 50 }, () => crypto.randomUUID())
  for (const sid of sprayed) {
    accountFor(sid)
    await view(sid)
  }
  expect(store.accountCount()).toBe(0)
  // and a v0 read leaves an existing caller's projection as it was
  store.account('s_seen')
  const before = await (await view('s_seen')).json()
  accountFor('s_seen')
  const after = await (await view('s_seen')).json()
  expect(after.revision).toBe(before.revision)
})

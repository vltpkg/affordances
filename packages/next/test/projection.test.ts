import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { compileSync } from '../src/compile.ts'
import { createProjectionRoute, type ProjectionBinding } from '../src/projection.ts'

// RFC 0005 §5's projection route, end to end: a v0 app compiled by compileSync, its bindings as bindings.ts names them,
// and the route serving views, inspections and executions, with the v0 action run in v0's context

let root: string
let route: ReturnType<typeof createProjectionRoute>
let routeOptions: Parameters<typeof createProjectionRoute>[0]
const calls: unknown[] = []
;(globalThis as { projectionCalls?: unknown[] }).projectionCalls = calls

beforeAll(async () => {
  root = mkdtempSync(path.join(import.meta.dirname, '.fixture-'))
  const src = path.join(import.meta.dirname, '..', 'src', 'index.ts')
  mkdirSync(path.join(root, 'app', 'products', '[slug]'), { recursive: true })
  writeFileSync(
    path.join(root, 'app', 'products', '[slug]', 'actions.ts'),
    `'use server'
import { defineAction } from ${JSON.stringify(src)}
import { z } from 'zod'
export const addToCart = defineAction({
  name: 'addToCart',
  id: 'shop.cart.add',
  description: 'Add a product to the cart',
  input: z.object({ slug: z.string(), quantity: z.number().int() }),
  expose: 'confirm',
  requires: 'At most five at once',
  guard: async ({ input }) => input === undefined || input.quantity <= 5,
  run: async (input, ctx) => {
    ;(globalThis as { projectionCalls?: unknown[] }).projectionCalls!.push({ input, via: ctx.via, session: ctx.session })
    return { added: input.quantity }
  },
})
export const peek = defineAction({
  name: 'peek',
  id: 'shop.cart.peek',
  description: 'See what a product costs in the cart',
  input: z.object({ slug: z.string() }),
  expose: 'session',
  run: async () => {
    ;(globalThis as { projectionCalls?: unknown[] }).projectionCalls!.push('peek')
    return { total: 0 }
  },
})
`,
  )
  const compiled = compileSync(root, {
    namespace: 'https://shop.example/capabilities',
    owner: { id: 'shop', name: 'Shop' },
  })
  if (compiled.failed)
    throw new Error(`the fixture doesn't compile: ${JSON.stringify(compiled.diagnostics)}`)
  // bindings as bindings.ts names them: each capability's action, by its export, and how to call it
  const loaded = new Map<string, Record<string, unknown>>()
  const exportOf = async (file: string, local: string) => {
    if (!loaded.has(file)) loaded.set(file, await import(pathToFileURL(path.join(root, file)).href))
    return loaded.get(file)![local]
  }
  const bindings: Record<string, ProjectionBinding> = {}
  for (const b of compiled.bindings)
    bindings[b.capability] = {
      action: await exportOf(b.export.file, b.export.local),
      route: b.address.route,
      name: b.address.action,
      params: b.params,
      guards: Object.fromEntries(
        await Promise.all(
          Object.entries(b.guards).map(async ([id, g]) => [id, await exportOf(g.file, g.local)]),
        ),
      ),
    }
  routeOptions = {
    manifest: JSON.parse(compiled.canonical!),
    bindings,
    resources: {
      products: {
        load: async (key) => (key === 'tee' ? { attributes: { slug: 'tee' } } : null),
        list: async () => ['tee'],
      },
    },
    principal: (request) =>
      request.headers.get('authorization') === 'Bearer u1'
        ? { authenticated: true, subject: 'u1', attributes: {} }
        : { authenticated: false, attributes: {} },
    session: (request) =>
      request.headers.get('authorization') === 'Bearer u1' ? { id: 'u1' } : null,
  }
  route = createProjectionRoute(routeOptions)
}, 120_000)

afterAll(() => rmSync(root, { recursive: true, force: true }))

const signedIn = { authorization: 'Bearer u1' }
const get = (p: string, headers: Record<string, string> = signedIn) =>
  route.GET(new Request(`https://shop.test/api/projection${p}`, { headers }))
const post = (op: string, body: unknown, headers: Record<string, string> = signedIn) =>
  route.POST(
    new Request(`https://shop.test/api/projection/${op}`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json', ...headers },
    }),
  )
type View = { offers: { id: string; capability: string }[] }
const offerOf = async () =>
  ((await (await get('?policy=exhaustive')).json()) as View).offers.find(
    (o) => o.capability === 'shop.cart.add',
  )!.id

test('the view is the caller’s, never cached by anything shared, and lists the compiled capability', async () => {
  const response = await get('?policy=exhaustive')
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(await offerOf()).toMatch(/^shop\.cart\.add@products:tee/)
})

test('inspect shows an offer, and one the caller can’t see answers 404, as one that doesn’t exist', async () => {
  expect((await get(`/inspect?offer=${encodeURIComponent(await offerOf())}`)).status).toBe(200)
  expect((await get('/inspect?offer=shop.cart.add@products:nope')).status).toBe(404)
})

test('execute: refused for a confirmation, then run once with its token, as the v0 action in v0’s agent context', async () => {
  const offer = await offerOf()
  const call = { offer, input: { slug: 'tee', quantity: 2 } }
  const first = await post('execute', call)
  expect(first.status).toBe(409)
  const refused = (await first.json()) as { code: string; confirmation: { approval: string } }
  expect(refused.code).toBe('confirmation_required')
  const done = await post('execute', { ...call, approval: refused.confirmation.approval })
  expect(done.status).toBe(200)
  expect(calls).toEqual([
    { input: { slug: 'tee', quantity: 2 }, via: 'agent', session: { id: 'u1' } },
  ])
})

test('the v0 guard, as the capability’s opaque precondition, refuses what it would', async () => {
  const response = await post('execute', {
    offer: await offerOf(),
    input: { slug: 'tee', quantity: 9 },
  })
  expect([response.status, ((await response.json()) as { code: string }).code]).toEqual([
    409,
    'precondition',
  ])
})

test('RFC 0004 §2.3’s statuses: 401 with a challenge for a caller who isn’t signed in', async () => {
  const response = await post(
    'execute',
    { offer: await offerOf(), input: { slug: 'tee', quantity: 1 } },
    {},
  )
  expect([response.status, response.headers.get('www-authenticate')]).toEqual([401, 'Bearer'])
})

test('a cookie POST without the site’s Origin is refused, and an unknown operation is 404', async () => {
  expect((await post('execute', { offer: 'x' }, { cookie: 'sid=u1' })).status).toBe(403)
  expect((await post('nothing', {})).status).toBe(404)
  expect((await post('execute', 'not an object')).status).toBe(400)
})

// review's 0324d2ae and the planner (14:40Z): same-origin is the request's own origin, its scheme and the host it was
// addressed by (its Host), compared exactly; allowedOrigins adds exactly what it lists; forwarded headers are never read
const cookiePost = (url: string, headers: Record<string, string>, r = route) =>
  r.POST(
    new Request(url, {
      method: 'POST',
      body: JSON.stringify({ offer: 'x' }),
      headers: { 'content-type': 'application/json', cookie: 'sid=u1', ...headers },
    }),
  )
// under next start, request.url names localhost whatever host the browser used
const local = 'http://localhost:3000/api/projection/execute'
// 403 is the Origin refusal; past it, the call reaches the route (here a 401, since the cookie authenticates no one)
const passes = async (res: Promise<Response>) => (await res).status !== 403
const originStatus = async (headers: Record<string, string>) =>
  (await cookiePost(local, headers)).status

describe('a cookie POST’s Origin', () => {
  test('127.0.0.1 and localhost each pass as same-origin', async () => {
    expect(
      await passes(cookiePost(local, { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000' })),
    ).toBe(true)
    expect(
      await passes(cookiePost(local, { host: 'localhost:3000', origin: 'http://localhost:3000' })),
    ).toBe(true)
  })
  test('a cross-origin call, a port or scheme mismatch, a forged X-Forwarded-Host, and no or null Origin are refused', async () => {
    expect(await originStatus({ host: '127.0.0.1:3000', origin: 'https://evil.test' })).toBe(403)
    expect(await originStatus({ host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3001' })).toBe(
      403,
    )
    expect(await originStatus({ host: '127.0.0.1:3000', origin: 'https://127.0.0.1:3000' })).toBe(
      403,
    )
    expect(
      await originStatus({
        host: '127.0.0.1:3000',
        'x-forwarded-host': 'evil.test',
        'x-forwarded-proto': 'https',
        origin: 'https://evil.test',
      }),
    ).toBe(403)
    expect(await originStatus({ host: '127.0.0.1:3000' })).toBe(403)
    expect(await originStatus({ host: '127.0.0.1:3000', origin: 'null' })).toBe(403)
  })
  test('allowedOrigins admits exactly what it lists, and must list origins', async () => {
    const proxied = createProjectionRoute({
      ...routeOptions,
      allowedOrigins: ['https://shop.example'],
    })
    const via = (origin: string) => cookiePost(local, { host: 'localhost:3000', origin }, proxied)
    expect(await passes(via('https://shop.example'))).toBe(true)
    expect(await passes(via('https://shop.example:8443'))).toBe(false)
    expect(await passes(via('http://shop.example'))).toBe(false)
    expect(await passes(via('https://www.shop.example'))).toBe(false)
    expect(() =>
      createProjectionRoute({ ...routeOptions, allowedOrigins: ['https://shop.example/'] }),
    ).toThrow(/isn't an origin/)
  })
})

test('concurrent first requests share one runtime, so a token one signs runs through the other', async () => {
  const fresh = createProjectionRoute(routeOptions)
  const offer = await offerOf()
  const confirm = () =>
    fresh.POST(
      new Request('https://shop.test/api/projection/execute', {
        method: 'POST',
        body: JSON.stringify({ offer, input: { slug: 'tee', quantity: 1 } }),
        headers: { 'content-type': 'application/json', ...signedIn },
      }),
    )
  const tokens = await Promise.all([confirm(), confirm()]).then((rs) =>
    Promise.all(
      rs.map(
        async (r) =>
          ((await r.json()) as { confirmation: { approval: string } }).confirmation.approval,
      ),
    ),
  )
  for (const approval of tokens) {
    const r = await fresh.POST(
      new Request('https://shop.test/api/projection/execute', {
        method: 'POST',
        body: JSON.stringify({ offer, input: { slug: 'tee', quantity: 1 }, approval }),
        headers: { 'content-type': 'application/json', ...signedIn },
      }),
    )
    expect(r.status).toBe(200)
  }
})

// design (2026-11-18), for RFC 0002 R2: per-process approval defaults are a replay on a multi-instance deploy, so a
// deployed route requires both. The gate fails closed (review of b96dee48): only development and test get defaults
test('outside development and test, a missing approvalKey or seenTokens throws when the route is made', () => {
  const store = { claim: async () => true }
  try {
    for (const env of ['production', '', 'staging']) {
      vi.stubEnv('NODE_ENV', env)
      expect(() => createProjectionRoute(routeOptions)).toThrow(
        /needs approvalKey and seenTokens unless NODE_ENV is development or test/,
      )
      expect(() => createProjectionRoute({ ...routeOptions, seenTokens: store })).toThrow(
        /needs approvalKey unless/,
      )
    }
    // and unset, as a plain node server has it
    vi.stubEnv('NODE_ENV', undefined)
    expect(() => createProjectionRoute(routeOptions)).toThrow(/needs approvalKey and seenTokens/)
    for (const env of ['development', 'test']) {
      vi.stubEnv('NODE_ENV', env)
      expect(() => createProjectionRoute(routeOptions)).not.toThrow()
    }
  } finally {
    vi.unstubAllEnvs()
  }
})

// the route keeps its own copy of the runtime's approval gate, since the runtime loads on the first request and the
// gate holds when the route is made: the two say the same, for every case
// what a call throws, as text
const message = (f: () => unknown) => {
  try {
    f()
  } catch (error) {
    return (error as Error).message
  }
  return 'no error'
}
// the gate is a security decision, so the copy is held to the runtime's on every input: for each NODE_ENV, unset
// included, and each combination of key and store, both pass or both throw, with the same message
test("the route's approval gate decides as the runtime's does, in every case, word for word", async () => {
  const { approvalGate } = await import('@affordances/runtime')
  const store = { claim: async () => true }
  const key = {} as CryptoKey
  let checked = 0
  try {
    for (const env of [undefined, '', 'staging', 'production', 'development', 'test']) {
      vi.stubEnv('NODE_ENV', env)
      for (const given of [
        {},
        { seenTokens: store },
        { approvalKey: key },
        { approvalKey: key, seenTokens: store },
      ]) {
        const theirs = message(() => approvalGate('createProjectionRoute', given))
        expect([
          env,
          Object.keys(given),
          message(() => createProjectionRoute({ ...routeOptions, ...given })),
        ]).toEqual([env, Object.keys(given), theirs])
        checked++
      }
    }
  } finally {
    vi.unstubAllEnvs()
  }
  expect(checked).toBe(24)
})

test('a token claimed through one instance’s shared store is refused when replayed through another', async () => {
  const approvalKey = (await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ])) as CryptoKey
  // a shared single-use store, as a database's unique insert would be
  const spent = new Set<string>()
  const seenTokens = { claim: async (nonce: string) => !spent.has(nonce) && !!spent.add(nonce) }
  const [one, two] = [0, 1].map(() =>
    createProjectionRoute({ ...routeOptions, approvalKey, seenTokens }),
  )
  const offer = await offerOf()
  const call = (r: typeof one, approval?: string) =>
    r!.POST(
      new Request('https://shop.test/api/projection/execute', {
        method: 'POST',
        body: JSON.stringify({ offer, input: { slug: 'tee', quantity: 1 }, approval }),
        headers: { 'content-type': 'application/json', ...signedIn },
      }),
    )
  const { confirmation } = (await (await call(one)).json()) as {
    confirmation: { approval: string }
  }
  const before = calls.length
  expect((await call(one, confirmation.approval)).status).toBe(200)
  // a spent token is no approval: the replay is asked to confirm again, and the action has run once
  const replay = await call(two, confirmation.approval)
  expect([replay.status, ((await replay.json()) as { code: string }).code]).toEqual([
    409,
    'confirmation_required',
  ])
  expect(calls.length - before).toBe(1)
})

// RFC 0004 §2's check (the planner, folded into M7b2): steps 1 to 7 without running, never a token
describe('POST {base}/check', () => {
  test('an allowed, a refused and a confirmation_required call, with no token anywhere and nothing run', async () => {
    const before = calls.length
    const offer = await offerOf()
    // the action asks for confirmation: check says so, with the summary, and no approval
    const asked = await post('check', { offer, input: { slug: 'tee', quantity: 2 } })
    const askedBody = await asked.text()
    expect([asked.status, JSON.parse(askedBody).code]).toEqual([409, 'confirmation_required'])
    expect(JSON.parse(askedBody).confirmation).toEqual({ summary: expect.any(String) })
    // the guard's opaque condition refuses a quantity over five
    const refused = await post('check', { offer, input: { slug: 'tee', quantity: 9 } })
    const refusedBody = await refused.text()
    expect([refused.status, JSON.parse(refusedBody).code]).toEqual([409, 'precondition'])
    // and a caller who isn't signed in is refused as unauthorized, with a challenge
    const anonymous = await post('check', { offer, input: { slug: 'tee', quantity: 1 } }, {})
    expect([anonymous.status, anonymous.headers.get('www-authenticate')]).toEqual([401, 'Bearer'])
    for (const text of [askedBody, refusedBody, await anonymous.text()])
      expect(text).not.toMatch(/approval/)
    expect(calls.length).toBe(before)
  })

  test('a call that passes every check is ok, with its revision, runs nothing, and a token sent along is ignored', async () => {
    const before = calls.length
    const view = (await (await get('?policy=exhaustive')).json()) as View
    const offer = view.offers.find((o) => o.capability === 'shop.cart.peek')!.id
    const r = await post('check', { offer, input: { slug: 'tee' }, approval: 'forged' })
    const body = await r.text()
    expect([r.status, JSON.parse(body)]).toEqual([
      200,
      { status: 'ok', revision: expect.any(String) },
    ])
    expect(body).not.toMatch(/approval/)
    expect(calls.length).toBe(before)
  })
})

test('a start that isn’t type:key or an id is a 400, never read as no start', async () => {
  for (const start of [7, '', { type: 'x' }])
    expect(
      (
        await post('execute', {
          offer: await offerOf(),
          input: { slug: 'tee', quantity: 1 },
          start,
        })
      ).status,
    ).toBe(400)
})

// code review of M8 (the v1 wire, RFC 0004 §1 and §2.3): every protocol-1 response names version 1's media type, and
// every refusal the route makes before the runtime has the runtime's refusal shape, a code and a detail
const V1 = 'application/vnd.affordances+json; version=1'
test('protocol 1 answers with its own media type: views, executions and refusals', async () => {
  expect((await get('?policy=exhaustive')).headers.get('content-type')).toBe(V1)
  expect((await post('execute', { offer: 'x' })).headers.get('content-type')).toBe(V1)
  expect((await post('execute', 'not an object')).headers.get('content-type')).toBe(V1)
})

test('a refusal before the runtime is a refusal: the Origin as unauthorized, a malformed body as invalid_input, an unknown operation as not_found', async () => {
  const origin = await post('execute', { offer: 'x' }, { cookie: 'sid=u1' })
  expect(origin.status).toBe(403)
  expect(await origin.json()).toEqual({
    status: 'refused',
    code: 'unauthorized',
    detail: expect.stringMatching(/Origin/),
  })
  const malformed = await post('execute', 'not an object')
  expect(malformed.status).toBe(400)
  expect(await malformed.json()).toEqual({
    status: 'refused',
    code: 'invalid_input',
    detail: 'The body is a JSON object',
  })
  const unknown = await post('nothing', {})
  expect(unknown.status).toBe(404)
  expect(await unknown.json()).toEqual({
    status: 'refused',
    code: 'not_found',
    detail: 'No projection operation nothing',
  })
})

// code review of M8 (#5): expand's budget is held to the view's rule, offers and facts as positive whole numbers and
// nothing else, and anything else is a 400 refusal, never passed to the runtime
test('an expansion’s budget is offers and facts, each a positive whole number, or a 400', async () => {
  const from = await offerOf()
  for (const budget of [
    null,
    'x',
    [],
    { offers: 0 },
    { offers: 1.5 },
    { facts: -1 },
    { facts: '2' },
    { depth: 1 },
    { offers: 1, other: 1 },
  ]) {
    const response = await post('expand', { from, along: 'alternatives', budget })
    expect([JSON.stringify(budget), response.status]).toEqual([JSON.stringify(budget), 400])
    expect(await response.json()).toMatchObject({ status: 'refused', code: 'invalid_input' })
  }
  for (const budget of [{}, { offers: 1 }, { facts: 3 }, { offers: 2, facts: 1 }])
    expect((await post('expand', { from, along: 'alternatives', budget })).status).toBe(200)
})

// code review of M8 (simplify #3, skipped for a drift test): the generic tools' hand-written input schemas and the
// route's hand validation are held together. The same keys, the same required fields and the same directions; a call
// built from each schema is accepted (never a 400), and one missing each required field is refused with a 400
// a response's status
const status = async (r: Promise<Response>) => (await r).status
test('the generic tools’ input schemas and the route accept the same calls', async () => {
  const { GENERIC_TOOLS } = await import('@affordances/runtime/agent')
  const { ALONG } = await import('@affordances/runtime')
  const schema = (name: string) =>
    GENERIC_TOOLS.find((t) => t.name === name)!.inputSchema as {
      properties: Record<string, { enum?: string[] }>
      required?: string[]
    }
  expect(
    Object.fromEntries(
      GENERIC_TOOLS.map((t) => [
        t.name,
        [Object.keys(schema(t.name).properties), schema(t.name).required ?? []],
      ]),
    ),
  ).toEqual({
    project: [['start'], []],
    expand: [
      ['from', 'along'],
      ['from', 'along'],
    ],
    inspect: [['offer'], ['offer']],
    execute: [['offer', 'input'], ['offer']],
  })
  expect(schema('expand').properties.along!.enum).toEqual([...ALONG])
  const offer = await offerOf()
  // a call from each schema: accepted, whatever it then answers
  expect(await status(get('?start=shop.product:tee'))).not.toBe(400)
  expect(await status(get(`/inspect?offer=${encodeURIComponent(offer)}`))).not.toBe(400)
  expect(await status(post('execute', { offer, input: { slug: 'tee', quantity: 1 } }))).not.toBe(
    400,
  )
  // a direction that doesn't apply to an offer is the runtime's to answer; the route never calls it unknown
  const refusedAs = await Promise.all(
    ALONG.map(async (along) => {
      const r = await post('expand', { from: offer, along })
      return r.status === 400 ? (await r.json()).detail : 'accepted'
    }),
  )
  expect(refusedAs.filter((d: string) => /along is one of/.test(d))).toEqual([])
  // a direction the tools don't list is refused, named against the same list
  const unknown = await post('expand', { from: offer, along: 'sideways' })
  expect([unknown.status, (await unknown.json()).detail]).toEqual([
    400,
    `along is one of ${ALONG.join(', ')}`,
  ])
  // each required field missing: refused with a 400
  for (const [op, body] of [
    ['expand', { along: 'alternatives' }],
    ['expand', { from: offer }],
    ['execute', { input: {} }],
  ] as const)
    expect([op, Object.keys(body), await status(post(op, body))]).toEqual([
      op,
      Object.keys(body),
      400,
    ])
  expect(await status(get('/inspect'))).toBe(400)
})

import { TOKEN } from '@affordances/runtime/agent'
import { describe, expect, test } from 'vitest'
import { confirmFor, httpAdapter, registerWebMcp } from '../src/index.ts'

// RFC 0004 §5, as amended (intake, 2026-11-18): WebMCP's tools fail closed. No tool channel ever yields an approval;
// in-tool consent happens only where the browser offers requestUserInteraction

// a token as the runtime makes one, so the boundary's pattern has something real to catch
const APPROVAL = 'apv1~c29tZS1vZmZlcg~0123456789abcdefABCDEF_-'

type Registered = {
  name: string
  execute: (
    args: Record<string, unknown>,
    client?: unknown,
  ) => Promise<{ content: { text: string }[]; isError?: true }>
}
const fakeContext = () => {
  const tools: Registered[] = []
  return { tools, registerTool: (t: Registered) => void tools.push(t) }
}

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
const yes = async () => true

// the protocol-1 endpoints, as the projection route answers them: execute refuses for confirmation with a token, and
// runs only with that token
const server = () => {
  const calls: { url: string; body?: Record<string, unknown> }[] = []
  const fetcher = (async (url: string, init?: RequestInit) => {
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined
    calls.push({ url, ...(body && { body }) })
    if (url.includes('/execute'))
      return body?.approval === APPROVAL
        ? json({
            status: 'succeeded',
            output: { plan: 'pro' },
            observed: [],
            undeclared: [],
            revision: 'r2',
            changes: { added: [], removed: [], changed: [] },
          })
        : json(
            {
              status: 'refused',
              code: 'confirmation_required',
              confirmation: {
                summary: 'Move proj_1 to Pro, for 20 USD a month',
                approval: APPROVAL,
                expiresAt: '2026-11-18T14:00:00Z',
              },
              revision: 'r1',
            },
            403,
          )
    return json({
      revision: 'r1',
      policy: 'exhaustive',
      offers: [],
      choiceSets: [],
      order: { by: 'canonical' },
      omitted: { offers: 0, choiceSets: 0, claims: 0, expand: [] },
    })
  }) as typeof fetch
  return { calls, fetcher }
}

const register = (ask = async () => true) => {
  const context = fakeContext()
  const s = server()
  const names = registerWebMcp({ base: '/api/projection', ask, context, fetcher: s.fetcher })
  const tool = context.tools.find((t) => t.name === 'execute')!
  const execute = (args: Record<string, unknown>, client?: unknown) => tool.execute(args, client)
  return { names, context, execute, calls: s.calls }
}

// a model-bound result: nothing in it is a token, an approval field, or a way to approve
const assertNoApproval = (result: { content: { text: string }[] }) => {
  const text = result.content.map((c) => c.text).join('\n')
  expect(text.match(TOKEN)).toBeNull()
  expect(text).not.toContain(APPROVAL)
  expect(text).not.toMatch(/"approval"/)
}

test('the generic tools register by default, and nothing registers where the browser has no WebMCP', () => {
  expect(register().names).toEqual(['project', 'expand', 'inspect', 'execute'])
  expect(
    registerWebMcp({ base: '/api/projection', ask: async () => true, context: undefined }),
  ).toEqual([])
})

describe('a call that needs confirmation', () => {
  test('without requestUserInteraction (every current browser): only the refusal, with no token and no approve path', async () => {
    const { execute, calls } = register()
    // what Chromium 156's WebMCP gives execute as its client: { signal } and nothing else (SPIKE.md)
    const result = await execute(
      { offer: 'hosting.plan.subscribe@hosting.plan:p2', input: {} },
      { signal: new AbortController().signal },
    )
    assertNoApproval(result)
    expect(result.content[0]!.text).toContain('confirmation_required')
    // it never resent: the one execute was the refused one
    expect(calls.filter((c) => c.url.includes('/execute'))).toHaveLength(1)
  })

  test('with requestUserInteraction, on the person’s accept: one resend with the token, which the model never sees', async () => {
    // A FAKE client: no real build exposes requestUserInteraction yet (SPIKE.md). It stands in for the browser running
    // the page's prompt inside a user interaction
    const client = { requestUserInteraction: async (ask: () => Promise<unknown>) => ask() }
    const { execute, calls } = register(async () => true)
    const result = await execute(
      { offer: 'hosting.plan.subscribe@hosting.plan:p2', input: {} },
      client,
    )
    assertNoApproval(result)
    expect(result.content[0]!.text).toContain('succeeded')
    const executes = calls.filter((c) => c.url.includes('/execute'))
    expect(executes.map((c) => c.body?.approval)).toEqual([undefined, APPROVAL])
  })

  test('with requestUserInteraction, on the person’s decline: the refusal, and no resend', async () => {
    // the same FAKE client as above
    const client = { requestUserInteraction: async (ask: () => Promise<unknown>) => ask() }
    const { execute, calls } = register(async () => false)
    const result = await execute(
      { offer: 'hosting.plan.subscribe@hosting.plan:p2', input: {} },
      client,
    )
    assertNoApproval(result)
    expect(calls.filter((c) => c.url.includes('/execute'))).toHaveLength(1)
  })
})

test('consent is feature-detected: a client without requestUserInteraction gives no confirm at all', () => {
  const ask = yes
  for (const client of [
    undefined,
    null,
    {},
    { signal: new AbortController().signal },
    { requestUserInteraction: 'no' },
  ])
    expect(confirmFor(client, ask)).toBeUndefined()
  expect(confirmFor({ requestUserInteraction: async () => true }, ask)).toBeTypeOf('function')
})

test('every tool response passes the boundary: no tool, on any call, returns a token or an approval', async () => {
  const { context } = register()
  expect(context.tools).toHaveLength(4)
  for (const tool of context.tools)
    assertNoApproval(
      await tool.execute({
        offer: 'hosting.plan.subscribe@hosting.plan:p2',
        input: {},
        from: 'x',
        along: 'more',
      }),
    )
})

test('the adapter keeps the connection’s start, as type:key, on every later call', async () => {
  const s = server()
  const adapter = httpAdapter('/api/projection', s.fetcher)
  await adapter.project({ type: 'hosting.project', key: 'proj_1' })
  await adapter.inspect('hosting.plan.subscribe@hosting.plan:p2')
  await adapter.execute({ offer: 'hosting.plan.subscribe@hosting.plan:p2', input: {} })
  expect(s.calls[0]!.url).toBe('/api/projection/view?start=hosting.project%3Aproj_1')
  expect(s.calls[1]!.url).toContain('start=hosting.project%3Aproj_1')
  expect(s.calls[2]!.body?.start).toBe('hosting.project:proj_1')
})

test("the page's view request rides on every call: its policy on view, inspect and execute alike", async () => {
  const s = server()
  const adapter = httpAdapter('/api/projection', s.fetcher, { policy: 'exhaustive' })
  await adapter.project(undefined)
  await adapter.inspect('hosting.plan.subscribe@hosting.plan:p2')
  await adapter.execute({ offer: 'hosting.plan.subscribe@hosting.plan:p2', input: {} })
  expect(s.calls[0]!.url).toBe('/api/projection/view?policy=exhaustive')
  expect(s.calls[1]!.url).toContain('policy=exhaustive')
  expect(s.calls[2]!.body?.policy).toBe('exhaustive')
})

test("the page's start is the first view's when the agent names none, and the agent's own start wins", async () => {
  const context = fakeContext()
  const s = server()
  registerWebMcp({
    base: '/api/projection',
    ask: yes,
    context,
    fetcher: s.fetcher,
    start: { type: 'hosting.project', key: 'proj_1' },
  })
  const project = context.tools.find((t) => t.name === 'project')!
  await project.execute({})
  await project.execute({ start: { type: 'hosting.plan', key: 'p2' } })
  expect(s.calls.map((c) => c.url)).toEqual([
    '/api/projection/view?start=hosting.project%3Aproj_1',
    '/api/projection/view?start=hosting.plan%3Ap2',
  ])
  // without one, today's site-wide view
  const bare = fakeContext()
  const s2 = server()
  registerWebMcp({ base: '/api/projection', ask: yes, context: bare, fetcher: s2.fetcher })
  await bare.tools.find((t) => t.name === 'project')!.execute({})
  expect(s2.calls[0]!.url).toBe('/api/projection/view')
})

test('the signal reaches every registerTool, where Chromium unregisters the tool when it aborts', () => {
  const given: { name: string; signal?: AbortSignal }[] = []
  const context = {
    registerTool: (t: { name: string }, options?: { signal?: AbortSignal }) =>
      void given.push({ name: t.name, ...(options?.signal && { signal: options.signal }) }),
  }
  const registration = new AbortController()
  const names = registerWebMcp({
    base: '/api/projection',
    ask: yes,
    context,
    fetcher: server().fetcher,
    signal: registration.signal,
  })
  expect(given.map((g) => g.name)).toEqual(names)
  expect(given.every((g) => g.signal === registration.signal)).toBe(true)
  // without one, nothing is passed that a browser could read as a signal
  const bare: { signal?: AbortSignal }[] = []
  registerWebMcp({
    base: '/api/projection',
    ask: yes,
    context: {
      registerTool: (_t: unknown, o?: { signal?: AbortSignal }) => void bare.push(o ?? {}),
    },
    fetcher: server().fetcher,
  })
  expect(bare.every((o) => o.signal === undefined)).toBe(true)
})

test("a browser's duplicate-name rejection is caught, and any other rejection still surfaces", async () => {
  // the browser's own rejection: a DOMException named InvalidStateError, as registration.json records
  const context = {
    registerTool: () =>
      Promise.reject(new DOMException('Duplicate tool name', 'InvalidStateError')),
  }
  const names = registerWebMcp({
    base: '/api/projection',
    ask: yes,
    context,
    fetcher: server().fetcher,
  })
  expect(names).toEqual(['project', 'expand', 'inspect', 'execute'])
  // let the rejections settle: vitest fails the run on any left unhandled
  await new Promise((r) => setTimeout(r, 10))
  // the handler each registration's promise gets: it rethrows anything that isn't InvalidStateError
  const handlers: ((error: unknown) => unknown)[] = []
  class Watched extends Promise<void> {
    override catch(onRejected?: ((error: unknown) => unknown) | null) {
      if (onRejected) handlers.push(onRejected)
      return Promise.resolve() as never
    }
  }
  registerWebMcp({
    base: '/api/projection',
    ask: yes,
    context: { registerTool: () => new Watched((resolve) => resolve()) },
    fetcher: server().fetcher,
  })
  expect(handlers).toHaveLength(4)
  expect(() =>
    handlers[0]!(new DOMException('Duplicate tool name', 'InvalidStateError')),
  ).not.toThrow()
  const other = new TypeError('not a tool')
  expect(() => handlers[0]!(other)).toThrow(other)
})

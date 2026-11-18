import { canonicalJson, type CapabilityManifest } from '@affordances/ir'
import {
  builtInPolicies,
  createRuntime,
  type Principal,
  type ResourceResolver,
} from '@affordances/runtime'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { ElicitRequestSchema, type ElicitResult } from '@modelcontextprotocol/sdk/types.js'
import { describe, expect, test, vi } from 'vitest'
import plansJson from '../../ir/fixtures/valid/plans.json' with { type: 'json' }
import { createRuntimeAdapter } from '@affordances/runtime/agent-runtime'
import { createMcpServer, exportable } from '../src/index.ts'

// M7c: RFC 0004 §4's MCP modes over the plans fixture. Generic tools carry the views exactly; confirmation goes to the
// person by elicitation, with exactly the summary the token binds, and only an explicit accept runs it; the model
// never holds a token; the per-capability mode's annotations never skip a confirmation

// the plans fixture, with the list open to anyone, and a safe query anyone may call that still asks for confirmation
const manifestOf = (): CapabilityManifest => {
  const m = structuredClone(plansJson) as unknown as CapabilityManifest
  m.capabilities.find((c) => c.id === 'hosting.plan.list')!.authorization = { principal: 'any' }
  m.capabilities.push({
    id: 'hosting.plan.quote',
    kind: 'query',
    description: 'Quote a plan',
    safe: true,
    authorization: { principal: 'any' },
    confirmation: { summary: 'Quote the plans' },
  })
  return m
}
const up = [{ code: 'us', zones: [{ up: true }] }]
const rows: Record<string, Record<string, unknown>> = {
  hobby: { slug: 'hobby', priceUsd: 0, regions: up },
  pro: { slug: 'pro', priceUsd: 20, regions: up },
}
const projects: Record<string, Record<string, unknown>> = {
  p1: { id: 'p1', orgId: 'o1', domains: ['a.example'] },
}
const table = (r: Record<string, Record<string, unknown>>): ResourceResolver => ({
  load: async (key) => (r[key] ? { attributes: r[key] } : null),
  list: async () => Object.keys(r),
})
const resources = { 'hosting.plan': table(rows), 'hosting.project': table(projects) }
const member: Principal = {
  authenticated: true,
  subject: 'u1',
  attributes: { plan: 'hobby', orgIds: ['o1'] },
}
const ran: string[] = []
const handlers = {
  'hosting.plan.subscribe': {
    guards: { billing: () => true },
    run: (input: unknown) => (ran.push(`subscribe ${JSON.stringify(input)}`), 'ok'),
  },
  'hosting.plan.quote': { run: () => (ran.push('quote'), [1, 2]) },
  'hosting.plan.list': { run: () => [] },
  'hosting.plan.cancel': { run: () => (ran.push('cancel'), 'ok') },
}

// a client connected to a fresh server; answer decides each elicitation, or the client has none
const connect = async (
  options: {
    seenTokens?: { claim: (nonce: string, expiresAt: Date) => Promise<boolean> }
    answer?: (message: string) => Promise<ElicitResult> | ElicitResult
    mode?: 'generic' | 'per-capability'
    principal?: Principal
    timeout?: number
  } = {},
) => {
  const server = createMcpServer({
    manifest: manifestOf(),
    resources,
    handlers,
    principal: options.principal ?? member,
    request: { start: { type: 'hosting.project', key: 'p1' }, policy: 'exhaustive' },
    mode: options.mode,
    elicitTimeoutMs: options.timeout,
    ...(options.seenTokens && { seenTokens: options.seenTokens }),
  })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await server.connect(a)
  const client = new Client(
    { name: 'm7c', version: '0' },
    options.answer ? { capabilities: { elicitation: {} } } : undefined,
  )
  const asked: string[] = []
  if (options.answer) {
    const answer = options.answer
    client.setRequestHandler(ElicitRequestSchema, async (r) => {
      const message = (r.params as { message: string }).message
      asked.push(message)
      return answer(message)
    })
  }
  await client.connect(b)
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args })
    const body = (result.content as { text: string }[])[0]!.text
    // an error's text, or the result, parsed
    return {
      body,
      value: (result.isError ? { error: body } : JSON.parse(body)) as Record<string, any>,
    }
  }
  return { client, call, asked }
}
const SUBSCRIBE = 'hosting.plan.subscribe@hosting.plan:pro?project=p1'
// the summary the runtime binds into a token for this call, read straight from the runtime
const boundSummary = async () => {
  const key = (await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ])) as CryptoKey
  const rt = createRuntime({
    manifest: manifestOf(),
    resources,
    handlers,
    approvalKeys: { current: key },
    seenTokens: { claim: async () => true },
  })
  const r = await rt.execute({
    principal: member,
    offer: SUBSCRIBE,
    input: { projectId: 'p1', seats: [2] },
    view: { start: { type: 'hosting.project', key: 'p1' }, policy: 'exhaustive' },
  } as never)
  return (r as { confirmation: { summary: string } }).confirmation.summary
}

// the tools a connection lists, for a principal
const names = async (principal: Principal) =>
  (await (await connect({ principal })).client.listTools()).tools.map((t) => t.name)

describe('the generic mode (RFC 0004 §3, §4)', () => {
  test('the same four tools for every connection, whoever the principal', async () => {
    expect(await names(member)).toEqual(['project', 'expand', 'inspect', 'execute'])
    expect(await names({ authenticated: false, attributes: {} })).toEqual(await names(member))
  })

  test('project returns the view, byte for byte, under every built-in policy, with every capability id unchanged', async () => {
    const key = (await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, [
      'sign',
      'verify',
    ])) as CryptoKey
    for (const policy of builtInPolicies) {
      const server = createMcpServer({
        manifest: manifestOf(),
        resources,
        handlers,
        principal: member,
        request: { start: { type: 'hosting.project', key: 'p1' }, policy: policy.id },
      })
      const [a, b] = InMemoryTransport.createLinkedPair()
      await server.connect(a)
      const client = new Client({ name: 'm7c', version: '0' })
      await client.connect(b)
      const got = (
        (await client.callTool({ name: 'project', arguments: {} })).content as { text: string }[]
      )[0]!.text
      const rt = createRuntime({
        manifest: manifestOf(),
        resources,
        handlers,
        approvalKeys: { current: key },
        seenTokens: { claim: async () => true },
      })
      const view = (
        await rt.project({
          principal: member,
          start: { type: 'hosting.project', key: 'p1' },
          policy: policy.id,
        })
      ).view()
      expect({ policy: policy.id, same: got === canonicalJson(view) }).toEqual({
        policy: policy.id,
        same: true,
      })
      const ids = (JSON.parse(got) as { offers: { capability: string }[] }).offers.map(
        (o) => o.capability,
      )
      expect(ids.every((id) => manifestOf().capabilities.some((c) => c.id === id))).toBe(true)
    }
  })
})

describe('confirmation goes to the person (RFC 0004 §4)', () => {
  const input = { projectId: 'p1', seats: [2] }

  test('an explicit accept runs it once, after showing exactly the summary the token binds, charges included', async () => {
    ran.length = 0
    const s = await connect({ answer: () => ({ action: 'accept', content: {} }) })
    const r = await s.call('execute', { offer: SUBSCRIBE, input })
    expect(r.value).toMatchObject({ status: 'succeeded' })
    expect(s.asked).toEqual([await boundSummary()])
    expect(s.asked[0]).toMatch(/Charges:/)
    // once, with the target's key filled in from the offer (RFC 0002 §8.1)
    expect(ran).toEqual([`subscribe ${JSON.stringify({ ...input, planId: 'pro' })}`])
  })

  test.each(['decline', 'cancel'] as const)(
    '%s gives the refusal, runs nothing, and carries no token',
    async (action) => {
      ran.length = 0
      const s = await connect({ answer: () => ({ action }) })
      const r = await s.call('execute', { offer: SUBSCRIBE, input })
      expect(r.value).toMatchObject({
        status: 'refused',
        code: 'confirmation_required',
        answered: action,
      })
      expect(r.value.confirmation).not.toHaveProperty('approval')
      expect(ran).toEqual([])
    },
  )

  test('no answer before the timeout is a refusal', async () => {
    ran.length = 0
    const s = await connect({ answer: () => new Promise(() => {}), timeout: 50 })
    const r = await s.call('execute', { offer: SUBSCRIBE, input })
    expect(r.value).toMatchObject({ status: 'refused', answered: 'timeout' })
    expect(ran).toEqual([])
  })

  test('a client without elicitation gets the refusal and the summary, never a token, and the model can’t pass one', async () => {
    ran.length = 0
    const s = await connect()
    const r = await s.call('execute', { offer: SUBSCRIBE, input })
    expect(r.value).toMatchObject({
      status: 'refused',
      code: 'confirmation_required',
      confirmation: { summary: await boundSummary() },
    })
    expect(r.value.confirmation).not.toHaveProperty('approval')
    // execute has no approval argument: one the model makes up is ignored, and asks again
    const forged = await s.call('execute', { offer: SUBSCRIBE, input, approval: 'forged' })
    expect(forged.value).toMatchObject({ status: 'refused', code: 'confirmation_required' })
    expect(ran).toEqual([])
  })

  // review of 3a02e2c8: the run after an accept can itself be refused for confirmation (the token already spent, the
  // revision moved), and the runtime then issues a fresh token, which must not reach the model
  test('a re-run refused after an accept carries no token either', async () => {
    ran.length = 0
    // a store that refuses every claim: the accepted token never runs, and the runtime asks again
    const s = await connect({
      answer: () => ({ action: 'accept', content: {} }),
      seenTokens: { claim: async () => false },
    })
    const r = await s.call('execute', { offer: SUBSCRIBE, input })
    expect(r.value).toMatchObject({ status: 'refused', code: 'confirmation_required' })
    expect(r.body).not.toMatch(/approval/)
    expect(ran).toEqual([])
  })

  test('each accept is its own single-use token: a second execute asks again', async () => {
    ran.length = 0
    const s = await connect({ answer: () => ({ action: 'accept', content: {} }) })
    await s.call('execute', { offer: SUBSCRIBE, input })
    await s.call('execute', { offer: SUBSCRIBE, input })
    expect(s.asked).toHaveLength(2)
    expect(ran).toHaveLength(2)
  })

  test('the approval gate fails closed outside development and test, as the projection route’s does', () => {
    try {
      for (const env of ['production', 'staging', '']) {
        vi.stubEnv('NODE_ENV', env)
        expect(() =>
          createMcpServer({ manifest: manifestOf(), resources, principal: member }),
        ).toThrow(/needs approvalKey and seenTokens unless NODE_ENV is development or test/)
      }
      vi.stubEnv('NODE_ENV', undefined)
      expect(() =>
        createMcpServer({ manifest: manifestOf(), resources, principal: member }),
      ).toThrow(/needs approvalKey/)
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

describe('the per-capability mode (RFC 0004 §4)', () => {
  test('one tool per capability anyone may call, named by its id, with MCP’s annotations', async () => {
    const s = await connect({ mode: 'per-capability' })
    const tools = (await s.client.listTools()).tools
    expect(tools.map((t) => t.name)).toEqual(exportable(manifestOf()).map((c) => c.id))
    expect(tools.map((t) => t.name)).toEqual(['hosting.plan.list', 'hosting.plan.quote'])
    expect(tools.find((t) => t.name === 'hosting.plan.quote')!.annotations).toMatchObject({
      readOnlyHint: true,
    })
  })

  test('annotations never skip confirmation: a safe-annotated capability that needs it still asks the person', async () => {
    ran.length = 0
    const declined = await connect({
      mode: 'per-capability',
      answer: () => ({ action: 'decline' }),
    })
    expect((await declined.call('hosting.plan.quote')).value).toMatchObject({
      status: 'refused',
      code: 'confirmation_required',
    })
    expect([declined.asked, ran]).toEqual([['Quote the plans'], []])
    const accepted = await connect({
      mode: 'per-capability',
      answer: () => ({ action: 'accept', content: {} }),
    })
    expect((await accepted.call('hosting.plan.quote')).value).toMatchObject({ status: 'succeeded' })
    expect(ran).toEqual(['quote'])
  })
})

// the adapter option (the planner, 15:55Z): the same server over another adapter, as M7f's MCP pilot runs it over
// protocol 1 to the trial's own server. Over an adapter equivalent to its in-process one, the tool list, a view and an
// elicited execution are the same bytes
const viaBoth = async (mode: 'generic' | 'per-capability') => {
  const runs: string[][] = []
  for (const via of ['in process', 'adapter'] as const) {
    const options = {
      manifest: manifestOf(),
      resources,
      handlers,
      principal: member,
      request: { start: { type: 'hosting.project' as const, key: 'p1' }, policy: 'exhaustive' },
    }
    const server =
      via === 'adapter'
        ? createMcpServer({
            adapter: createRuntimeAdapter({ ...options, caller: 'test' }),
            manifest: options.manifest,
            mode,
          })
        : createMcpServer({ ...options, mode })
    const [a, b] = InMemoryTransport.createLinkedPair()
    await server.connect(a)
    const client = new Client(
      { name: 'adapter', version: '0' },
      { capabilities: { elicitation: {} } },
    )
    client.setRequestHandler(ElicitRequestSchema, async () => ({ action: 'accept', content: {} }))
    await client.connect(b)
    const text = async (name: string, args: Record<string, unknown> = {}) =>
      JSON.stringify(await client.callTool({ name, arguments: args }))
    const out = [JSON.stringify(await client.listTools())]
    if (mode === 'generic')
      out.push(
        await text('project'),
        await text('execute', { offer: SUBSCRIBE, input: { projectId: 'p1', seats: [2] } }),
      )
    runs.push(out)
    await client.close()
  }
  return runs
}

test('over the adapter option: the same tools, views and confirmed executions as in process', async () => {
  const generic = await viaBoth('generic')
  expect(generic[1]).toEqual(generic[0])
  // and it's a real run, not two identical errors: the confirmed execution succeeded
  expect(generic[0]!.at(-1)).toMatch(/succeeded/)
  const perCapability = await viaBoth('per-capability')
  expect(perCapability[1]).toEqual(perCapability[0])
})

import type { CapabilityManifest } from '@affordances/ir'
import type { Principal, ResourceResolver } from '@affordances/runtime'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { ElicitRequestSchema, type ElicitResult } from '@modelcontextprotocol/sdk/types.js'
import { afterEach, expect, test, vi } from 'vitest'
import plansJson from '../../ir/fixtures/valid/plans.json' with { type: 'json' }
import { TOKEN, toModel } from '@affordances/runtime/agent'
import { createMcpServer } from '../src/index.ts'

// the planner (after review of 3a02e2c8): every tool result reaches the model through one boundary, and no result
// carries an approval token, for every tool and mode and every outcome. A generated sweep, checked two ways: no
// `approval` field, and none of the runtime's token bytes, read from the tokens it actually issued

// the plans fixture: the list and a safe quote open to anyone, the quote asking for confirmation
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
const member: Principal = {
  authenticated: true,
  subject: 'u1',
  attributes: { plan: 'hobby', orgIds: ['o1'] },
}
const START = { type: 'hosting.project', key: 'p1' }
const SUBSCRIBE = 'hosting.plan.subscribe@hosting.plan:pro?project=p1'
const CANCEL = 'hosting.plan.cancel@hosting.plan:pro'

// a seeded generator, so a failing case names its seed
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let x = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296
}

type Answer = 'accept' | 'decline' | 'cancel' | 'timeout' | 'none'
// what happens between the person's accept and the run: nothing, the token already spent, it expired, the state moved
type Between = 'nothing' | 'spent' | 'expired' | 'moved'
type Case = {
  mode: 'generic' | 'per-capability'
  answer: Answer
  between: Between
  calls: [string, Record<string, unknown>][]
}

const GENERIC_CALLS: [string, Record<string, unknown>][] = [
  ['project', {}],
  ['project', { start: START }],
  ['inspect', { offer: SUBSCRIBE }],
  ['inspect', { offer: 'no.such@offer' }],
  ['expand', { from: 'hosting.plan.subscribe@hosting.plan', along: 'comparison' }],
  ['expand', { from: 'nothing', along: 'members' }],
  // confirmation_required, then the answer
  ['execute', { offer: SUBSCRIBE, input: { projectId: 'p1', seats: [2] } }],
  // a precondition false: seats over 50
  ['execute', { offer: SUBSCRIBE, input: { projectId: 'p1', seats: [99] } }],
  // an action that needs no confirmation
  ['execute', { offer: CANCEL, input: {} }],
  // an offer that doesn't exist: the runtime's error
  ['execute', { offer: 'hosting.plan.nothing@x', input: {} }],
  ['unknown', {}],
]
const PER_CAPABILITY_CALLS: [string, Record<string, unknown>][] = [
  ['hosting.plan.list', {}],
  ['hosting.plan.quote', {}],
  ['hosting.plan.subscribe', {}],
]
const caseOf = (seed: number): Case => {
  const next = rng(seed)
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)]!
  const mode = pick(['generic', 'per-capability'] as const)
  const pool = mode === 'generic' ? GENERIC_CALLS : PER_CAPABILITY_CALLS
  return {
    mode,
    answer: pick(['accept', 'decline', 'cancel', 'timeout', 'none'] as const),
    between: pick(['nothing', 'spent', 'expired', 'moved'] as const),
    calls: Array.from({ length: 1 + Math.floor(next() * 5) }, () => pick(pool)),
  }
}

// a resolver over rows a case may change while it runs
const table = (r: Record<string, Record<string, unknown>>): ResourceResolver => ({
  load: async (key) => (r[key] ? { attributes: r[key] } : null),
  list: async () => Object.keys(r),
})

// runs one case, returning every text the model received, and every token the runtime issued
const run = async (c: Case) => {
  const rows: Record<string, Record<string, unknown>> = {
    hobby: { slug: 'hobby', priceUsd: 0, regions: up },
    pro: { slug: 'pro', priceUsd: 20, regions: up },
  }
  let clock = Date.UTC(2026, 10, 18, 12)
  const spent = new Set<string>()
  const server = createMcpServer({
    manifest: manifestOf(),
    resources: {
      'hosting.plan': table(rows),
      'hosting.project': table({ p1: { id: 'p1', orgId: 'o1', domains: ['a.example'] } }),
    },
    handlers: {
      'hosting.plan.subscribe': { guards: { billing: () => true }, run: () => 'subscribed' },
      'hosting.plan.cancel': { run: () => 'cancelled' },
      'hosting.plan.list': { run: () => [] },
      'hosting.plan.quote': { run: () => [1] },
    },
    principal: member,
    request: { start: START, policy: 'exhaustive' },
    mode: c.mode,
    elicitTimeoutMs: 20,
    approvalTtlMs: 60_000,
    now: () => clock,
    seenTokens: {
      claim: async (nonce) => {
        if (c.between === 'spent' || spent.has(nonce)) return false
        spent.add(nonce)
        return true
      },
    },
  })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await server.connect(a)
  const client = new Client(
    { name: 'boundary', version: '0' },
    c.answer === 'none' ? undefined : { capabilities: { elicitation: {} } },
  )
  if (c.answer !== 'none')
    client.setRequestHandler(ElicitRequestSchema, async (): Promise<ElicitResult> => {
      if (c.answer === 'timeout') return new Promise(() => {})
      // between the ask and the run: time passes past the expiry, or the target's state changes
      if (c.between === 'expired') clock += 120_000
      if (c.between === 'moved') rows.pro = { ...rows.pro, priceUsd: 25 }
      return c.answer === 'accept'
        ? { action: 'accept', content: {} }
        : { action: c.answer as 'decline' | 'cancel' }
    })
  await client.connect(b)
  const texts: string[] = []
  for (const [name, args] of c.calls) {
    const result = await client.callTool({ name, arguments: args })
    texts.push(...(result.content as { text: string }[]).map((x) => x.text))
  }
  return texts
}

// the bytes of every token the runtime issues: each ends with its HMAC, base64url, which crypto.subtle.sign makes.
// Recording every signature, then looking for it in what the model got, checks the actual tokens, not their shape
const issued: string[] = []
const base64url = (b: ArrayBuffer) => Buffer.from(b).toString('base64url')
const sign = crypto.subtle.sign.bind(crypto.subtle)
vi.spyOn(crypto.subtle, 'sign').mockImplementation(
  async (...args: Parameters<SubtleCrypto['sign']>) => {
    const mac = await sign(...args)
    issued.push(base64url(mac))
    return mac
  },
)
afterEach(() => {
  issued.length = 0
})

const SEEDS = Array.from({ length: 80 }, (_, i) => 9100 + i)

test('no tool result in any mode, tool or outcome carries an approval field or a token', async () => {
  let confirmations = 0
  let tokens = 0
  for (const seed of SEEDS) {
    const c = caseOf(seed)
    const before = issued.length
    const texts = await run(c)
    const macs = issued.slice(before)
    tokens += macs.length
    for (const t of texts) {
      // none of this case's actual tokens' bytes, anywhere in what the model got
      for (const mac of macs)
        expect({ seed, leaked: t.includes(mac) }).toEqual({ seed, leaked: false })
      if (t.includes('confirmation_required')) confirmations++
      expect({ seed, approval: /"approval"/.test(t), token: TOKEN.test(t) }).toEqual({
        seed,
        approval: false,
        token: false,
      })
      TOKEN.lastIndex = 0
    }
  }
  // the sweep isn't vacuous: the runtime issued tokens, and confirmations reached the model, along the way
  expect(tokens).toBeGreaterThan(10)
  expect(confirmations).toBeGreaterThan(10)
}, 300_000)

test('the seeds cover every mode, answer and what happens between the ask and the run', () => {
  const cases = SEEDS.map(caseOf)
  expect(new Set(cases.map((c) => c.mode)).size).toBe(2)
  expect(new Set(cases.map((c) => c.answer)).size).toBe(5)
  expect(new Set(cases.map((c) => c.between)).size).toBe(4)
  const tools = new Set(cases.flatMap((c) => c.calls.map(([n]) => n)))
  for (const [n] of [...GENERIC_CALLS, ...PER_CAPABILITY_CALLS]) expect(tools.has(n)).toBe(true)
})

test('toModel removes approval at any depth, and token-shaped text anywhere, from objects and from error text', () => {
  const token =
    '2026-11-18T12:05:00.000Z~iajABhV7yV3toPQe8-7tcQ~bBQlWpo6CG4q1OWJVUOjuyUoYEc1Nv628RyICS3YaQ4'
  const object = toModel({
    a: { confirmation: { approval: token, summary: 's' } },
    list: [{ approval: 'x' }],
    note: `see ${token}`,
  })
  const out = object.content[0]!.text
  expect(out).not.toContain(token)
  expect(out).not.toMatch(/"approval"/)
  expect(JSON.parse(out)).toEqual({
    a: { confirmation: { summary: 's' } },
    list: [{}],
    note: 'see [withheld]',
  })
  const error = toModel(`failed with ${token}`, true)
  expect([error.isError, error.content[0]!.text]).toEqual([true, 'failed with [withheld]'])
})

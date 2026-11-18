import { beforeEach, expect, test } from 'vitest'
import type { CapabilityManifest } from '@affordances/ir'
import plansJson from '../../ir/fixtures/valid/plans.json' with { type: 'json' }
import type { Principal, ResourceResolver, TokenStore } from '../src/index.ts'
import { testRuntime } from './support/runtime.ts'

// what's approved, summarized and run is one value (intake, 2026-11-18): the effective input, with the input schema's
// defaults applied, and a summary that lists every charge with its amount (RFC 0001 §3.2 and §4, RFC 0002 §8.1-8.2).
// The fixture is plans.json's subscribe, with a G-like default add-on

type Instances = Record<string, Record<string, unknown>>
let ran: unknown[]
beforeEach(() => {
  ran = []
})
const plans: Instances = { pro: { slug: 'pro', priceUsd: 20, regions: [] } }
const projects: Instances = { p1: { id: 'p1', orgId: 'o1', domains: ['a.example'] } }
const table = (rows: Instances): ResourceResolver => ({
  load: async (key) => (rows[key] ? { attributes: structuredClone(rows[key]!) } : null),
  list: async () => Object.keys(rows),
})
const memoryStore = (): TokenStore => {
  const seen = new Set<string>()
  return { claim: async (nonce) => (seen.has(nonce) ? false : (seen.add(nonce), true)) }
}
const member: Principal = {
  authenticated: true,
  subject: 'u1',
  attributes: { plan: 'hobby', orgIds: ['o1'] },
}
const pro = 'hosting.plan.subscribe@hosting.plan:pro'

// subscribe takes addOns, defaulting to ['support'], and charges 20 USD once for the support add-on when it's kept
const manifest = () => {
  const m = structuredClone(plansJson) as unknown as CapabilityManifest
  const c = m.capabilities[1]!
  c.preconditions = []
  const input = c.input as { properties: Record<string, unknown> }
  input.properties.addOns = { type: 'array', items: { type: 'string' }, default: ['support'] }
  input.properties.coupon = { type: 'string' }
  c.confirmation = { summary: 'Subscribe to {target.slug}, with add-ons {input.addOns}' }
  c.effects = [
    ...(c.effects ?? []),
    {
      category: 'financial',
      description: "The support add-on's first month",
      reversibility: 'irreversible',
      amount: { value: 20, currency: 'USD' },
      applies: {
        some: { of: 'input.addOns', where: { eq: [{ path: 'item' }, { value: 'support' }] } },
      },
    },
  ]
  return m
}

const setup = async (m = manifest()) =>
  testRuntime({
    manifest: m,
    resources: { 'hosting.plan': table(plans), 'hosting.project': table(projects) },
    handlers: {
      'hosting.plan.subscribe': {
        guards: { billing: () => true },
        // a handler that would default differently, if it ever defaulted on its own
        run: (input) => {
          const given = input as { addOns?: string[] }
          ran.push(given.addOns ?? ['handler-default'])
          return { ok: true }
        },
      },
      'hosting.plan.cancel': { run: () => undefined },
      'hosting.plan.list': { run: () => [] },
    },
    approvalKeys: {
      current: (await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, [
        'sign',
        'verify',
      ])) as CryptoKey,
    },
    seenTokens: memoryStore(),
  })

const summaryOf = async (rt: Awaited<ReturnType<typeof setup>>, input: unknown) => {
  const r = await rt.execute({ principal: member, offer: pro, input })
  if (r.status !== 'refused' || r.code !== 'confirmation_required')
    throw new Error(JSON.stringify(r))
  return r.confirmation!
}

test('an omitted input with a default renders the default, and its charge is listed', async () => {
  const rt = await setup()
  expect((await summaryOf(rt, { projectId: 'p1' })).summary).toBe(
    'Subscribe to pro, with add-ons ["support"]. Charges: 20 USD a month, until undone; 20 USD now, not refunded',
  )
})

test('a charge whose applies is false is left out, and the summary says what will run', async () => {
  const rt = await setup()
  expect((await summaryOf(rt, { projectId: 'p1', addOns: [] })).summary).toBe(
    'Subscribe to pro, with add-ons []. Charges: 20 USD a month, until undone',
  )
})

test('the offer’s summary, before any input, shows the default and its charge, never unknown for a default', async () => {
  const rt = await setup()
  const projection = await rt.project({
    principal: member,
    start: { type: 'hosting.project', key: 'p1' },
  })
  const offer = projection.offers.find((o) => o.id.startsWith(pro))!
  expect(offer.requirements.confirmation?.summary).toContain('with add-ons ["support"]')
  expect(offer.requirements.confirmation?.summary).not.toContain('unknown')
})

test('a truly unknown value still renders unknown, and an unknown applies is listed as may apply', async () => {
  const m = manifest()
  const c = m.capabilities[1]!
  c.confirmation = { summary: 'Subscribe to {target.slug} with coupon {input.coupon}' }
  c.effects = [
    {
      category: 'financial',
      description: 'A coupon charge',
      reversibility: 'irreversible',
      amount: { value: 'input.fee', currency: 'USD' },
      applies: { eq: [{ path: 'input.coupon' }, { value: 'x' }] },
    },
  ]
  ;(c.input as { properties: Record<string, unknown> }).properties.fee = { type: 'number' }
  const rt = await setup(m)
  // no coupon, no fee: the coupon is unknown, so the charge may apply, and its amount can't be resolved
  expect((await summaryOf(rt, { projectId: 'p1' })).summary).toBe(
    'Subscribe to pro with coupon unknown. Charges: amount unknown, not refunded (may apply)',
  )
})

test('the handler runs the effective input, never a default of its own', async () => {
  const rt = await setup()
  const first = await summaryOf(rt, { projectId: 'p1' })
  const done = await rt.execute({
    principal: member,
    offer: pro,
    input: { projectId: 'p1' },
    approval: first.approval,
  })
  expect(done.status).toBe('succeeded')
  expect(ran).toEqual([['support']])
})

test('an approval for one effective input can’t run another', async () => {
  const rt = await setup()
  // approved with the default kept
  const first = await summaryOf(rt, { projectId: 'p1' })
  // the same token, with the add-on dropped: a different effective input and summary, so a fresh confirmation
  const other = await rt.execute({
    principal: member,
    offer: pro,
    input: { projectId: 'p1', addOns: [] },
    approval: first.approval,
  })
  expect(other).toMatchObject({ status: 'refused', code: 'confirmation_required' })
  expect(ran).toEqual([])
  // while passing the default explicitly is the same effective input, so the approval holds
  const same = await rt.execute({
    principal: member,
    offer: pro,
    input: { projectId: 'p1', addOns: ['support'] },
    approval: first.approval,
  })
  expect(same.status).toBe('succeeded')
  expect(ran).toEqual([['support']])
})

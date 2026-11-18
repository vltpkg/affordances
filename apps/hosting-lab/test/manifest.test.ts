import { expect, test } from 'vitest'
import {
  conformanceCases,
  derive,
  digest,
  evaluate,
  fromModules,
  normalize,
  validate,
  type Context,
} from '@affordances/ir'
import { addOns, bundles, plans } from '../src/catalog.ts'
import * as capabilities from '../src/app/capabilities.ts'
import { manifest } from '../src/app/capabilities.ts'

// the fixed option set every benchmark condition shares (roadmap M4a)

// the benchmark's records pin this manifest by digest, so moving it into a capability module (RFC 0005 §1) must leave
// it byte for byte as it was: this is the digest of src/manifest.ts at 8298a927, before the move
const ON_RECORD = 'sha256-5wGv2c-mT5wJu9N542it5-327q9I3dVboRvAGUDucs4'

test('the capability module gives the manifest on record, byte for byte', async () => {
  expect(await digest(manifest)).toBe(ON_RECORD)
  // as a compiler reads it: the module's exports, its parts beside its defineManifest, give that same manifest
  const read = fromModules([{ file: 'src/app/capabilities.ts', exports: { ...capabilities } }], {})
  expect(read.diagnostics).toEqual([])
  expect(read.manifest).toBe(manifest)
})

test('the manifest is valid IR, with no errors and nothing left unknown', () => {
  const result = validate(manifest)
  expect(result.issues.filter((i) => i.code.startsWith('E_'))).toEqual([])
  expect(result.ok).toBe(true)
  // every action declares its effects, and none is only guards
  expect(
    result.issues.filter((i) => i.code === 'W_EFFECTS_UNKNOWN' || i.code === 'W_OPAQUE'),
  ).toEqual([])
})

test('every effect has a reversibility, and every compensable one names what undoes it', () => {
  const ids = new Set(manifest.capabilities.map((c) => c.id))
  const actions = manifest.capabilities.filter((d) => d.kind === 'action')
  expect(actions.filter((c) => !c.effects?.length).map((c) => c.id)).toEqual([])
  const effects = actions.flatMap((c) => c.effects!.map((e) => ({ id: c.id, ...e })))
  expect(effects.filter((e) => !e.reversibility).map((e) => `${e.id}: ${e.description}`)).toEqual(
    [],
  )
  expect(
    effects
      .filter((e) => e.reversibility === 'compensable' && !ids.has(e.compensatedBy!))
      .map((e) => `${e.id}: ${e.compensatedBy}`),
  ).toEqual([])
})

test('normalizing is idempotent, and the digest is stable', async () => {
  const once = normalize(manifest)
  expect(normalize(once)).toEqual(once)
  const value = await digest(manifest)
  expect(await digest(once)).toBe(value)
  expect(await digest(structuredClone(manifest))).toBe(value)
  expect(value).toMatch(/^sha256-[A-Za-z0-9_-]{43}$/)
})

test('the plans are one choice set, and the bundle is an alternative to subscribing', () => {
  expect(manifest.resources.find((r) => r.id === 'hosting.plan')?.alternatives).toBe(true)
  expect(manifest.relations).toEqual([
    expect.objectContaining({
      type: 'alternativeTo',
      from: 'hosting.bundle.subscribe',
      to: 'hosting.plan.subscribe',
    }),
  ])
})

test('every paid action needs a confirmation; reading and cancelling need none', () => {
  const byId = Object.fromEntries(manifest.capabilities.map((c) => [c.id, c]))
  const confirmed = (ids: string[]) => ids.filter((id) => byId[id]!.confirmation !== undefined)
  const paid = ['hosting.plan.subscribe', 'hosting.bundle.subscribe', 'hosting.addOn.add']
  expect(confirmed(paid)).toEqual(paid)
  expect(
    confirmed(['hosting.plan.list', 'hosting.subscription.cancel', 'hosting.addOn.remove']),
  ).toEqual([])
})

test('each declarative precondition has a context that makes it false, for the conformance kit', () => {
  const cases = conformanceCases(manifest)
  const declarative = manifest.capabilities.flatMap((c) =>
    [...(c.preconditions ?? []), ...(c.authorization?.conditions ?? [])]
      .filter((p) => 'expr' in p)
      .map((p) => `${c.id}#${p.id}`),
  )
  expect(cases.map((c) => `${c.capability}#${c.condition}`).toSorted()).toEqual(
    declarative.toSorted(),
  )
  expect(cases.filter((c) => c.context === undefined)).toEqual([])
})

test('derived edges: what each capability acts on, and what deploying creates', () => {
  const edges = derive(manifest)
  expect(edges).toContainEqual(
    expect.objectContaining({
      relation: 'produces',
      from: 'hosting.deployment.create',
      to: 'hosting.deployment',
    }),
  )
  expect(edges).toContainEqual(
    expect.objectContaining({
      relation: 'supports',
      from: 'hosting.plan',
      to: 'hosting.plan.subscribe',
    }),
  )
  expect(edges.every((e) => e.basis === 'inferred')).toBe(true)
})

test('the catalog fits the declared attributes, and its prices are the experiment', () => {
  expect(plans.map((p) => [p.slug, p.priceUsd])).toEqual([
    ['hobby', 0],
    ['pro', 20],
    ['business', 80],
  ])
  // the bundle costs less than its parts bought separately, as its claim says
  const proPlus = bundles[0]!
  const parts =
    plans.find((p) => p.slug === proPlus.plan)!.priceUsd +
    proPlus.addOns.reduce((sum, a) => sum + addOns.find((x) => x.slug === a)!.priceUsd, 0)
  expect(parts - proPlus.priceUsd).toBe(
    manifest.claims!.find((c) => c.id === 'bundleSaves')!.quantity!.value,
  )
})

// what each effect's description promises holds right after success, as a state written out by hand from the
// description. RFC 0002 §8.4 checks `establishes` against the state after a run, so a false one is a contradiction
const afterSuccess: Record<string, Context> = {
  'hosting.subscription.cancel': {
    target: {
      id: 'p_1',
      ownerId: 'u_1',
      plan: 'pro',
      renewsAs: 'hobby',
      addOns: [],
      buildMinutesUsed: 0,
      buildMinutesIncluded: 3000,
    },
  },
  'hosting.deployment.rollback': {
    target: { id: 'd_1', projectId: 'p_1', status: 'ready', current: true },
  },
}

test('every establishes holds in the state its effect describes', () => {
  const establishing = manifest.capabilities.flatMap((c) =>
    (c.effects ?? []).flatMap((e) =>
      'establishes' in e && e.establishes ? [{ id: c.id, expr: e.establishes }] : [],
    ),
  )
  expect(establishing.map((e) => e.id).toSorted()).toEqual(Object.keys(afterSuccess).toSorted())
  expect(establishing.map((e) => [e.id, evaluate(e.expr, afterSuccess[e.id]!)])).toEqual(
    establishing.map((e) => [e.id, true]),
  )
})

import { validate, type CapabilityManifest } from '@affordances/ir'
import { describe, expect, test } from 'vitest'
import { manifest } from '../src/app/capabilities.ts'
import { principalFor } from '../src/lib/resolvers.ts'
import { runtimeFor } from '../src/lib/runtime.ts'
import { account } from '../src/lib/store.ts'
import { TASK_EDITS } from '../src/lib/task-edits.ts'

// M8e's T8 fixture (apps/choice-bench/results/surfaces-t8/PLAN.md §3), on the real runtime with hosting-lab's own
// resolvers and handlers: where the deciding fact, which plans each region serves, sits in each policy's first view,
// from the project start a trial uses. The fixture as built is T8's manifest, the base with T8's claim edit. The two
// designs the plan rejects are small edits to it, so the test shows why each was rejected

type View = { offers: { capability: string }[]; choiceSets: { id: string; comparison?: unknown }[] }
type Compiled = {
  resources: { id: string; alternatives?: boolean }[]
  relations?: { type: string; from: string; to: string }[]
}

const asBuilt = () => TASK_EDITS.T8!.apply(manifest)
// the relation from hosting.plan.subscribe instead, which binds the project, so it's a start capability
const relatedFromSubscribe = () => {
  const m = structuredClone(asBuilt()) as unknown as Compiled
  m.relations = m.relations!.map((r) =>
    r.to === 'hosting.region.read' ? { ...r, from: 'hosting.plan.subscribe' } : r,
  )
  return m as unknown as CapabilityManifest
}
// the region without alternatives, so its offers form no choice set, and no comparison carries its attributes
const withoutAlternatives = () => {
  const m = structuredClone(asBuilt()) as unknown as Compiled
  m.resources = m.resources.map((r) => {
    if (r.id !== 'hosting.region') return r
    const { alternatives: _, ...rest } = r
    return rest
  })
  return m as unknown as CapabilityManifest
}

// the regions' offers, and the plans each serves, from a view's region choice set
const regionsIn = (v: View) => ({
  offers: v.offers.filter((o) => o.capability === 'hosting.region.read').length,
  plans: (
    v.choiceSets.find((s) => s.id === 'hosting.region.read@hosting.region')?.comparison as
      | { rows: { name: string; plans: string[] }[] }
      | undefined
  )?.rows.map((r) => [r.name, r.plans]),
})

const firstViews = async (m: CapabilityManifest, sid: string) => {
  expect(validate(m)).toMatchObject({ ok: true })
  const runtime = runtimeFor(m)
  const start = { type: 'hosting.project', key: account(sid).project.id }
  const principal = principalFor(sid)
  const full = (await runtime.project({ principal, policy: 'exhaustive', start })).view()
  const projection = await runtime.project({ principal, policy: 'progressive', start })
  const progressive = projection.view()
  const step = progressive.omitted.expand.find((e) => e.along === 'relations')
  const expanded = step
    ? await projection.expand({ from: step.from, along: step.along })
    : undefined
  return {
    // whether any region attribute appears anywhere in full's first view, as text
    fullHasAttributes: JSON.stringify(full).includes('jurisdiction'),
    full: regionsIn(full),
    progressive: regionsIn(progressive),
    expanded: expanded && regionsIn(expanded as never),
    step,
  }
}

const both = [
  ['EU West', ['business']],
  ['US East', ['hobby', 'pro', 'business']],
]

describe("T8's deciding fact, one step out (measured on the fixture as built)", () => {
  test('as built: full shows it first, and progressive one listed expansion from the start', async () => {
    const m = await firstViews(asBuilt(), 't8-depth-built')
    expect(m.full).toEqual({ offers: 2, plans: both })
    expect(m.fullHasAttributes).toBe(true)
    expect(m.progressive).toEqual({ offers: 0, plans: undefined })
    // the expansion progressive's own view lists: from the start, along relations
    expect(m.step?.from).toMatchObject({ type: 'hosting.project' })
    expect(m.expanded).toEqual({ offers: 2, plans: both })
  })

  test('without alternatives, rejected: the region offers are in the views, but no region attribute is', async () => {
    const m = await firstViews(withoutAlternatives(), 't8-depth-plain')
    expect(m.full).toEqual({ offers: 2, plans: undefined })
    expect(m.fullHasAttributes).toBe(false)
    expect(m.expanded).toEqual({ offers: 2, plans: undefined })
  })

  test('related from hosting.plan.subscribe, rejected: it binds the project, so progressive shows the regions first', async () => {
    const m = await firstViews(relatedFromSubscribe(), 't8-depth-subscribe')
    expect(m.progressive).toEqual({ offers: 2, plans: both })
  })
})

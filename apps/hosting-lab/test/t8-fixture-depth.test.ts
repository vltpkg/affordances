import {
  defineCapability,
  defineManifest,
  definePrincipal,
  defineResource,
  validate,
} from '@affordances/ir'
import { createRuntime } from '@affordances/runtime'
import { describe, expect, test } from 'vitest'
import { z } from 'zod'
import * as lab from '../src/app/capabilities.ts'
import { handlers, memoryTokens } from '../src/lib/handlers.ts'
import { principalFor, resolvers } from '../src/lib/resolvers.ts'
import { account } from '../src/lib/store.ts'

// M8e's T8 fixture (apps/choice-bench/results/surfaces-t8/PLAN.md §3), measured on the real runtime before the plan is
// approved: where the deciding fact, which plans each region serves, sits in each policy's first view, from the
// project start a trial uses. Nothing here changes the app: the region is added to a copy of the compiled manifest

const owner = definePrincipal({
  description: 'A signed-in account',
  attributes: z.object({ id: z.string() }),
})
const region = defineResource({
  id: 'hosting.region',
  description: 'A region a project can be served from, and the plans that serve it',
  key: 'slug',
  attributes: z.object({
    slug: z.string(),
    name: z.string(),
    jurisdiction: z.string(),
    plans: z.array(z.string()),
  }),
  // so the region offers are a choice set, which carries its comparison: a view's offers carry their target only as
  // a reference, so without one the regions' attributes are in no view at all (measured)
  alternatives: true,
})
const readRegion = defineCapability({
  id: 'hosting.region.read',
  kind: 'query',
  description: 'Read a region: where it is, and which plans serve it',
  target: region,
  input: z.object({ region: z.string() }),
  targetAt: 'region',
  principal: owner,
  authorization: { principal: 'authenticated' },
})
const REGIONS = [
  { slug: 'us-east', name: 'US East', jurisdiction: 'US', plans: ['hobby', 'pro', 'business'] },
  { slug: 'eu-west', name: 'EU West', jurisdiction: 'EU', plans: ['business'] },
]
const regions = defineManifest({
  namespace: lab.manifest.namespace,
  title: 'regions',
  owner: { id: 'hosting-lab', name: 'Hosting Lab (fictional)' },
  principal: owner,
  resources: [region],
  capabilities: [readRegion],
})

type Compiled = { resources: unknown[]; capabilities: unknown[]; relations?: unknown[] }
const withRegions = (from: string) => {
  const m = structuredClone(lab.manifest) as unknown as Compiled
  const r = regions as unknown as Compiled
  m.resources.push(...r.resources)
  m.capabilities.push(...r.capabilities)
  m.relations = [
    ...(m.relations ?? []),
    {
      type: 'relatedTo',
      from,
      to: 'hosting.region.read',
      description: 'Where a plan is served from',
    },
  ]
  return m
}

// the regions' offers, and the plans each serves, from a view's region choice set
const regionsIn = (v: {
  offers: { capability: string }[]
  choiceSets: { id: string; comparison?: unknown }[]
}) => ({
  offers: v.offers.filter((o) => o.capability === 'hosting.region.read').length,
  plans: (
    v.choiceSets.find((s) => s.id === 'hosting.region.read@hosting.region')?.comparison as
      | { rows: { name: string; plans: string[] }[] }
      | undefined
  )?.rows.map((r) => [r.name, r.plans]),
})

const firstViews = async (from: string) => {
  const m = withRegions(from)
  expect(validate(m as never)).toMatchObject({ ok: true })
  const runtime = createRuntime({
    manifest: m as never,
    resources: {
      ...resolvers,
      'hosting.region': {
        load: async (k: string) => {
          const r = REGIONS.find((x) => x.slug === k)
          return r ? { attributes: { ...r } } : null
        },
        list: async () => REGIONS.map((r) => r.slug),
      },
    },
    handlers: { ...handlers, 'hosting.region.read': { run: async () => ({}) } } as never,
    approvalKeys: {
      current: (await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, [
        'sign',
        'verify',
      ])) as CryptoKey,
    },
    seenTokens: memoryTokens(),
  })
  const sid = `t8-depth-${from}`
  const start = { type: 'hosting.project', key: account(sid).project.id }
  const principal = principalFor(sid)
  const full = (await runtime.project({ principal, policy: 'exhaustive', start })).view()
  const projection = await runtime.project({ principal, policy: 'progressive', start })
  const progressive = projection.view()
  const listed = progressive.omitted.expand
  const step = listed.find((e) => e.along === 'relations')
  const expanded = step
    ? await projection.expand({ from: step.from, along: step.along })
    : undefined
  return {
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

describe("T8's deciding fact, one step out (measured)", () => {
  test('related from hosting.plan.list: full shows it first, progressive one listed expansion from the start', async () => {
    const m = await firstViews('hosting.plan.list')
    expect(m.full).toEqual({ offers: 2, plans: both })
    expect(m.progressive).toEqual({ offers: 0, plans: undefined })
    // the expansion progressive's own view lists: from the start, along relations
    expect(m.step?.from).toMatchObject({ type: 'hosting.project' })
    expect(m.expanded).toEqual({ offers: 2, plans: both })
  })

  test('related from hosting.plan.subscribe, rejected: it binds the project, so progressive shows the regions first', async () => {
    const m = await firstViews('hosting.plan.subscribe')
    expect(m.progressive).toEqual({ offers: 2, plans: both })
  })
})

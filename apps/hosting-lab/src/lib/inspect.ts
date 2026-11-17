import { derive, type CapabilityManifest } from '@affordances/ir'
import {
  builtInPolicies,
  type CapabilityOffer,
  type PolicyId,
  type Principal,
} from '@affordances/runtime'
import { manifest } from '../manifest.ts'
import { runtime, runtimeFor } from './runtime.ts'

// the inspector's data (roadmap M3f): the manifest's definitions, and a projection for one principal. It shows
// every offer the principal may see, and marks which ones a policy's view leaves out, since what a view omits is
// what a developer most needs to see

export const POLICIES: PolicyId[] = builtInPolicies.map((p) => p.id)

export type InspectedOffer = CapabilityOffer & { inView: boolean }

// what the inspector shows of a manifest itself, derived edges included: the same for every request, so made once
const definitionsOf = (m: CapabilityManifest) => ({
  sources: m.sources,
  principal: m.principal,
  resources: m.resources,
  capabilities: m.capabilities,
  claims: m.claims ?? [],
  relations: m.relations ?? [],
  derived: derive(m),
})
const definitions = new WeakMap<CapabilityManifest, ReturnType<typeof definitionsOf>>()
const definitionsFor = (m: CapabilityManifest) => {
  let made = definitions.get(m)
  if (!made) definitions.set(m, (made = definitionsOf(m)))
  return made
}

export const inspect = async (
  principal: Principal,
  options: { policy?: PolicyId; m?: CapabilityManifest } = {},
) => {
  const policy = options.policy ?? 'exhaustive'
  const m = options.m ?? manifest
  // per request, only what depends on the caller: the projection and its view
  const projection = await (options.m ? runtimeFor(m) : runtime).project({
    principal,
    policy,
  })
  const view = projection.view()
  const shown = new Set(view.offers.map((o) => o.id))
  const offers: InspectedOffer[] = projection.offers.map((o) => ({ ...o, inView: shown.has(o.id) }))
  return {
    policy,
    revision: projection.revision,
    order: view.order,
    omitted: view.omitted,
    offers,
    choiceSets: projection.choiceSets.map((c) => ({
      ...c,
      inView: view.choiceSets.some((v) => v.id === c.id),
    })),
    definitions: definitionsFor(m),
  }
}

export type Inspection = Awaited<ReturnType<typeof inspect>>

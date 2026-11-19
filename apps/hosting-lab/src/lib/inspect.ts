import { derive, type CapabilityManifest } from '@affordances/ir'
import {
  builtInPolicies,
  keptColumns,
  type CapabilityOffer,
  type Comparison,
  type PolicyId,
  type Principal,
} from '@affordances/runtime'
import { manifest } from '../app/capabilities.ts'
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

// why a comparison column can't be cut (RFC 0002 §6.6): a claim shown on the set's members cites it, or the capability
// reads it, in a condition, an effect, or the confirmation summary the person approves. The runtime's own rule, so the
// marks are exactly the columns a view keeps; a policy that omits claims shows none, so cites none
const marksOf = (
  m: CapabilityManifest,
  set: { capability: string; members: string[] },
  claimsShown: boolean,
  offers: ReadonlyMap<string, CapabilityOffer>,
) => {
  const { cited, read } = keptColumns(
    m.capabilities.find((c) => c.id === set.capability),
    claimsShown ? set.members.flatMap((id) => offers.get(id)?.claims ?? []) : [],
  )
  return { cited: [...cited], read: [...read] }
}

export const inspect = async (
  principal: Principal,
  options: { policy?: PolicyId; m?: CapabilityManifest; facts?: number } = {},
) => {
  const policy = options.policy ?? 'exhaustive'
  const m = options.m ?? manifest
  const budget = options.facts === undefined ? undefined : { facts: options.facts }
  // per request, only what depends on the caller: the projection and its view
  const projection = await (options.m ? runtimeFor(m) : runtime).project({
    principal,
    policy,
    ...(budget && { budget }),
  })
  const view = projection.view()
  const shown = new Set(view.offers.map((o) => o.id))
  const offers: InspectedOffer[] = projection.offers.map((o) => ({ ...o, inView: shown.has(o.id) }))
  const byId = new Map(projection.offers.map((o) => [o.id, o]))
  const claimsShown = builtInPolicies.find((p) => p.id === policy)?.claims !== 'omitted'
  const choiceSets = await Promise.all(
    projection.choiceSets.map(async (c) => {
      const inView = view.choiceSets.find((v) => v.id === c.id)
      // a set the view leaves out still has its comparison, one expansion away: the inspector shows it, since it's
      // what an agent gets once it reaches the set
      const comparison: Comparison | undefined =
        inView?.comparison ??
        (
          await projection.expand({ from: c.id, along: 'comparison' }, budget && { budget })
        ).choiceSets.find((v) => v.id === c.id)?.comparison
      return {
        ...c,
        inView: inView !== undefined,
        comparison,
        marks: marksOf(m, c, claimsShown, byId),
      }
    }),
  )
  return {
    policy,
    facts: options.facts,
    revision: projection.revision,
    order: view.order,
    omitted: view.omitted,
    offers,
    choiceSets,
    definitions: definitionsFor(m),
  }
}

export type Inspection = Awaited<ReturnType<typeof inspect>>

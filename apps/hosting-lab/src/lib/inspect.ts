import { derive, type CapabilityManifest } from '@affordances/ir'
import {
  builtInPolicies,
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

// why a comparison column can't be cut (RFC 0002 §6.6): a shown claim on the capability cites it, or the capability
// itself reads it, in a condition, an effect, its input, or the confirmation summary the person approves (§6.6; intake,
// 2026-11-18). Both come from the manifest, so the inspector adds nothing to the wire
const marksOf = (m: CapabilityManifest, capability: string) => {
  const definition = m.capabilities.find((c) => c.id === capability)
  const cited = new Set(
    (m.claims ?? []).filter((c) => c.subject === capability).flatMap((c) => c.cites ?? []),
  )
  const reads = {
    conditions: [
      ...(definition?.authorization?.conditions ?? []),
      ...(definition?.preconditions ?? []),
    ],
    effects: definition?.effects ?? [],
    input: definition?.input ?? {},
    // a summary template names attributes as {target.x}, which the pattern below reads the same way
    summary: definition?.confirmation?.summary ?? '',
  }
  const read = new Set(
    [...JSON.stringify(reads).matchAll(/target\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((x) => x[1]!),
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
      return { ...c, inView: inView !== undefined, comparison, marks: marksOf(m, c.capability) }
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

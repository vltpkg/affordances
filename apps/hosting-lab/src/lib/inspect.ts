import { derive, type CapabilityManifest } from '@affordances/ir'
import {
  createRuntime,
  type CapabilityOffer,
  type PolicyId,
  type Principal,
} from '@affordances/runtime'
import { manifest } from '../manifest.ts'
import { handlers } from './guards.ts'
import { resolvers } from './resolvers.ts'

// the inspector's data (roadmap M3f): the manifest's definitions, and a projection for one principal. It shows
// every offer the principal may see, and marks which ones a policy's view leaves out, since what a view omits is
// what a developer most needs to see

export const POLICIES: PolicyId[] = ['exhaustive', 'resource', 'progressive', 'advocated']

export const runtime = createRuntime({ manifest, resources: resolvers, handlers })

export type InspectedOffer = CapabilityOffer & { inView: boolean }

export const inspect = async (
  principal: Principal,
  options: { policy?: PolicyId; m?: CapabilityManifest } = {},
) => {
  const policy = options.policy ?? 'exhaustive'
  const m = options.m ?? manifest
  const projection = await (
    options.m ? createRuntime({ manifest: m, resources: resolvers, handlers }) : runtime
  ).project({
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
    definitions: {
      sources: m.sources,
      principal: m.principal,
      resources: m.resources,
      capabilities: m.capabilities,
      claims: m.claims ?? [],
      relations: m.relations ?? [],
      derived: derive(m),
    },
  }
}

export type Inspection = Awaited<ReturnType<typeof inspect>>

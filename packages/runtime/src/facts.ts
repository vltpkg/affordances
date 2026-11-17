import {
  derive,
  digest,
  localId,
  normalize,
  type CapabilityDefinition,
  type CapabilityManifest,
  type Claim,
  type DerivedEdge,
  type Effect,
  type Id,
} from '@affordances/ir'

// words of a task or a definition, for the basic relevance method (§4.4): letters and digits, lowercased, three or
// more long, and not the commonest English words, which match everything
const STOP = new Set(
  'and the for but not you your our are was were with from that this have has had can will just into about also'.split(
    ' ',
  ),
)
export const words = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3 && !STOP.has(w)),
  )

export type Edge = { from: Id; to: Id; relation: string }

// what depends on the manifest alone, found once when the runtime starts, not on every request (simplify D1)
export type Facts = ReturnType<typeof factsOf>
export const factsOf = (manifest: CapabilityManifest) => {
  const local = (ref: string) => localId(manifest, ref)
  const capabilities = new Map(manifest.capabilities.map((c) => [c.id, c]))
  const resources = new Map(manifest.resources.map((r) => [r.id, r]))

  // relations between capabilities, declared and derived, with what each is (§6.5). A relation to another
  // manifest's definition has no offer here to reach
  const derived: DerivedEdge[] = derive(manifest)
  const edges: Edge[] = []
  for (const r of manifest.relations ?? []) {
    const [from, to] = [local(r.from), local(r.to)]
    if (from !== undefined && to !== undefined) edges.push({ from, to, relation: r.type })
  }
  for (const e of derived)
    if (e.relation === 'enables' || e.relation === 'prerequisite') edges.push(e)
  // each capability's neighbors, either way, in the order the edges come in
  const neighbors = new Map<Id, { id: Id; relation: string }[]>()
  for (const c of manifest.capabilities) neighbors.set(c.id, [])
  for (const e of edges) {
    if (capabilities.has(e.to)) neighbors.get(e.from)?.push({ id: e.to, relation: e.relation })
    // an edge from a capability to itself is one neighbor, not two
    if (capabilities.has(e.from) && e.from !== e.to)
      neighbors.get(e.to)?.push({ id: e.from, relation: e.relation })
  }
  // alternativeTo runs both ways (RFC 0001 §5.1)
  const partners = new Map<Id, Set<Id>>()
  for (const e of edges)
    if (e.relation === 'alternativeTo')
      for (const [a, b] of [
        [e.from, e.to],
        [e.to, e.from],
      ] as const)
        partners.set(a, (partners.get(a) ?? new Set()).add(b))

  // what the basic relevance method matches a task against: the capability's id, title and description, and its
  // target type's
  const wordsOf = new Map(
    manifest.capabilities.map((c) => {
      const resource = c.target ? resources.get(c.target) : undefined
      const text = [
        c.id,
        c.title ?? '',
        c.description,
        resource?.id ?? '',
        resource?.description ?? '',
      ]
      return [c.id, words(text.join(' '))]
    }),
  )
  // the claims about each capability (RFC 0001 §9)
  const claims = new Map<Id, Claim[]>()
  for (const k of manifest.claims ?? []) {
    const subject = local(k.subject)
    if (subject !== undefined) claims.set(subject, [...(claims.get(subject) ?? []), k])
  }
  // each type's declared attributes, for observation (§8.4)
  const declared = new Map(
    manifest.resources.map((r) => {
      const props = (r.attributes as { properties?: Record<string, unknown> } | undefined)
        ?.properties
      return [r.id, props ? new Set(Object.keys(props)) : undefined] as const
    }),
  )
  // the manifest normalized once: its digest, and each capability's effects in canonical order (RFC 0001 §7.2)
  const normalized = normalize(manifest)
  const effects = new Map<Id, Effect[]>(normalized.capabilities.map((c) => [c.id, c.effects ?? []]))
  const manifestDigest = digest(manifest)

  return {
    capability: (id: Id): CapabilityDefinition | undefined => capabilities.get(id),
    resource: (id: Id | undefined) => (id === undefined ? undefined : resources.get(id)),
    local,
    derived,
    edges,
    neighbors: (id: Id) => neighbors.get(id) ?? [],
    partners: (id: Id) => partners.get(id) ?? new Set<Id>(),
    wordsOf: (id: Id) => wordsOf.get(id) ?? new Set<string>(),
    claims: (id: Id) => claims.get(id) ?? [],
    declared: (type: Id) => declared.get(type),
    effects: (id: Id) => effects.get(id) ?? [],
    manifestDigest,
  }
}

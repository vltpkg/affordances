import { derive, type CapabilityManifest, type Id } from '@affordances/ir'
import type {
  Budget,
  CapabilityOffer,
  ChoiceSet,
  DiscoveryPolicy,
  Expansion,
  OfferDetails,
  OfferId,
  OrderBasis,
  ProjectionRequest,
  Relevance,
  RelevanceBasis,
  ResourceRef,
  View,
} from './types.ts'

// RFC 0002 §6.1's four policies. claims: what each shows, the example's progressive view leaving them out (§12)
export const BUILT_IN: DiscoveryPolicy[] = [
  {
    id: 'exhaustive',
    description: 'Everything the principal may see, in canonical order: the neutral baseline',
    scope: 'exhaustive',
    order: 'canonical',
    claims: 'shown',
  },
  {
    id: 'resource',
    description: 'The offers on the start resource, as a v0 page graph shows them',
    scope: 'start',
    order: 'canonical',
    claims: 'shown',
  },
  {
    id: 'progressive',
    description: 'The start resource and one step of relations, ordered by relevance to the task',
    scope: 'neighborhood',
    depth: 1,
    order: 'relevance',
    relevance: 'basic',
    claims: 'omitted',
  },
  {
    id: 'advocated',
    description: 'As progressive, with the offers the owner recommends first, and the claims shown',
    scope: 'neighborhood',
    depth: 1,
    order: { byClaim: 'recommendation' },
    relevance: 'basic',
    claims: 'shown',
  },
]

const sameRef = (a: ResourceRef | undefined, b: ResourceRef) =>
  a !== undefined && a.type === b.type && a.key === b.key

// words of a task or a definition, for the basic method: letters and digits, lowercased, three or more long, and
// not the commonest English words, which match everything
const STOP = new Set(
  'and the for but not you your our are was were with from that this have has had can will just into about also'.split(
    ' ',
  ),
)
const words = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3 && !STOP.has(w)),
  )

export type Views = {
  view(): View
  expand(expansion: Pick<Expansion, 'from' | 'along'>, options?: { budget?: Budget }): View
  inspect(offer: OfferId): OfferDetails | undefined
}

// views over one projection's offers: what a policy shows first, and every expansion from there (§6)
export const views = (args: {
  manifest: CapabilityManifest
  request: ProjectionRequest
  policy: DiscoveryPolicy
  revision: string
  offers: CapabilityOffer[] // every offer the principal may see, in canonical order
  choiceSets: ChoiceSet[]
}): Views => {
  const { manifest, request, policy, revision, choiceSets } = args
  const byId = new Map(args.offers.map((o) => [o.id, o]))
  const sets = new Map(choiceSets.map((s) => [s.id, s]))
  const start = request.start

  // relations between capabilities, declared and derived, both ways, with what each is (§6.5)
  const derived = derive(manifest)
  const local = (ref: string) =>
    ref.startsWith(`${manifest.namespace}#`) ? ref.slice(manifest.namespace.length + 1) : ref
  const edges: { from: Id; to: Id; relation: string }[] = []
  for (const r of manifest.relations ?? [])
    edges.push({ from: local(r.from), to: local(r.to), relation: r.type })
  for (const e of derived)
    if (e.relation === 'enables' || e.relation === 'prerequisite') edges.push(e)
  const capabilityIds = new Set(manifest.capabilities.map((c) => c.id))
  const neighbors = (id: Id) =>
    edges.flatMap((e) =>
      e.from === id && capabilityIds.has(e.to)
        ? [{ id: e.to, relation: e.relation }]
        : e.to === id && capabilityIds.has(e.from)
          ? [{ id: e.from, relation: e.relation }]
          : [],
    )
  const partners = (id: Id) =>
    new Set(
      edges.flatMap((e) =>
        e.relation !== 'alternativeTo' ? [] : e.from === id ? [e.to] : e.to === id ? [e.from] : [],
      ),
    )

  // the start: an instance, whose offers target it or bind it as a reference, or a capability or a resource type
  const onStart = (o: CapabilityOffer) => {
    if (start === undefined) return false
    if (typeof start === 'string') return o.capability === start || o.target?.type === start
    return (
      sameRef(o.target, start) ||
      Object.values(o.with ?? {}).some((key) => key === start.key && boundAs(o, start))
    )
  }
  const boundAs = (o: CapabilityOffer, ref: ResourceRef) => {
    const c = manifest.capabilities.find((x) => x.id === o.capability)
    return (c?.references ?? []).some(
      (r) => r.resource === ref.type && o.with?.[r.name] === ref.key,
    )
  }
  const startCapabilities = new Set(args.offers.filter(onStart).map((o) => o.capability))

  // §4.4's basic method: the start, a relation from a capability on the start, and words of the task. no number
  const task = request.task ? words(request.task.statement) : undefined
  const relevanceOf = (o: CapabilityOffer): Relevance => {
    if (!policy.relevance || !task) return { level: 'undetermined' }
    const basis: RelevanceBasis[] = []
    if (onStart(o))
      basis.push({
        kind: 'start',
        detail: typeof start === 'string' ? start : `${start!.type}:${start!.key}`,
      })
    const c = manifest.capabilities.find((x) => x.id === o.capability)!
    const resource = manifest.resources.find((r) => r.id === c.target)
    const own = words(
      [c.id, c.title ?? '', c.description, resource?.id ?? '', resource?.description ?? ''].join(
        ' ',
      ),
    )
    const matched = [...task].filter((w) => own.has(w)).toSorted()
    if (matched.length) basis.push({ kind: 'task-text', matched })
    const direct = basis.length > 0
    if (!onStart(o))
      for (const n of neighbors(o.capability))
        if (startCapabilities.has(n.id))
          basis.push({ kind: 'relation', relation: n.relation, from: n.id })
    return { level: direct ? 'direct' : basis.length ? 'related' : 'unrelated', basis }
  }
  const relevance = new Map(args.offers.map((o) => [o.id, relevanceOf(o)]))

  // §6.4: what an order is based on, and the order itself; ties keep canonical order
  const owner = manifest.sources.find((s) => s.role === 'owner')?.id
  const order: OrderBasis =
    policy.order === 'canonical'
      ? { by: 'canonical' }
      : policy.order === 'relevance'
        ? { by: 'relevance', method: policy.relevance ?? 'basic' }
        : { by: 'claim', kind: 'recommendation', source: owner ?? '' }
  const rank = (o: CapabilityOffer) => {
    if (order.by === 'relevance') {
      const level = relevance.get(o.id)!.level
      return level === 'direct' ? 0 : level === 'related' ? 1 : level === 'unrelated' ? 2 : 3
    }
    if (order.by === 'claim')
      return o.claims.some((k) => k.kind === 'recommendation' && k.source.id === order.source)
        ? 0
        : 1
    return 0
  }
  const canonical = new Map(args.offers.map((o, i) => [o.id, i]))
  const ordered = (ids: Iterable<OfferId>) =>
    [...new Set(ids)].toSorted(
      (a, b) => rank(byId.get(a)!) - rank(byId.get(b)!) || canonical.get(a)! - canonical.get(b)!,
    )

  // a choice set is whole or absent (§6.3, rule 2): an offer brings its set's other members
  const whole = (ids: Iterable<OfferId>) => {
    const all = new Set(ids)
    for (const id of new Set(all)) {
      const set = byId.get(id)!.choiceSet
      if (set) for (const m of sets.get(set)!.members) all.add(m)
    }
    return all
  }

  // the first view's scope (§6.1), before any budget
  const depth = request.budget?.depth ?? policy.budget?.depth ?? policy.depth ?? 1
  const scope = (): Set<OfferId> => {
    if (policy.scope === 'exhaustive') return new Set(byId.keys())
    const found = new Set(args.offers.filter(onStart).map((o) => o.id))
    if (start === undefined) for (const o of args.offers) if (!o.target) found.add(o.id)
    if (policy.scope === 'neighborhood') {
      let reached = new Set(startCapabilities)
      for (let step = 0; step < depth; step++) {
        const next = new Set(reached)
        for (const id of reached) for (const n of neighbors(id)) next.add(n.id)
        reached = next
      }
      for (const o of args.offers) if (reached.has(o.capability)) found.add(o.id)
    }
    return whole(found)
  }
  const firstScope = scope()

  // 'more' continues a sequence after its last shown offer: each page remembers what it was cut from
  const sequences = new Map<OfferId, OfferId[]>()

  // one page of a sequence: up to the budget, choice sets whole, and the rest counted and expandable (§6.3)
  const page = (sequence: OfferId[], budget: Budget | undefined, extra: Expansion[] = []): View => {
    const limit = budget?.offers ?? Infinity
    const shown: OfferId[] = []
    const cut: OfferId[] = []
    const skippedSets = new Set<string>()
    const placed = new Set<OfferId>()
    for (const id of sequence) {
      if (placed.has(id)) continue
      const set = byId.get(id)!.choiceSet
      const group = set ? ordered(sets.get(set)!.members).filter((m) => sequence.includes(m)) : [id]
      for (const m of group) placed.add(m)
      if (shown.length + group.length <= limit) shown.push(...group)
      else if (set && group.length > limit) skippedSets.add(set)
      else cut.push(...group)
    }
    const shownSet = new Set(shown)
    const expand: Expansion[] = [...extra]
    for (const set of skippedSets)
      expand.push({ from: set, along: 'members', count: sets.get(set)!.members.length })
    if (cut.length) {
      // the sequence goes on after the last offer shown, or from its start when nothing fit
      const cursor = shown.at(-1) ?? sequence[0]!
      sequences.set(cursor, cut)
      expand.push({ from: cursor, along: 'more', count: cut.length })
    }
    for (const id of shown) {
      const missing = [...partners(byId.get(id)!.capability)].flatMap((p) =>
        args.offers.filter((o) => o.capability === p && !shownSet.has(o.id)),
      )
      if (missing.length)
        expand.push({ from: id, along: 'alternatives', count: whole(alternatives(id)).size })
    }
    let claims = 0
    const offers = shown.map((id) => {
      const o = { ...byId.get(id)!, relevance: relevance.get(id)! }
      if (policy.claims === 'omitted') {
        claims += o.claims.length
        o.claims = []
      }
      return o
    })
    const shownSets = choiceSets.filter((s) => s.members.every((m) => shownSet.has(m)))
    const v: View = {
      revision,
      policy: policy.id,
      offers,
      choiceSets: shownSets.map((s) => ({ ...s, members: [...s.members] })),
      order,
      omitted: {
        offers: args.offers.length - shown.length,
        choiceSets: choiceSets.length - shownSets.length,
        claims,
        expand,
      },
    }
    if (request.seen !== undefined && request.seen !== revision) v.stale = true
    return v
  }

  const alternatives = (id: OfferId) =>
    [...partners(byId.get(id)!.capability)].flatMap((p) =>
      args.offers.filter((o) => o.capability === p).map((o) => o.id),
    )

  // what's outside the scope is one expansion from the start, along its relations (§12's example). with no start
  // instance to name, it's from the first offer the view shows
  const rest = args.offers.filter((o) => !firstScope.has(o.id)).map((o) => o.id)
  const first = ordered(firstScope)
  const restFrom: Expansion['from'] | undefined = !rest.length
    ? undefined
    : typeof start === 'object'
      ? start
      : (first[0] ?? args.offers[0]!.id)
  const view = () =>
    page(
      first,
      request.budget ?? policy.budget,
      restFrom === undefined ? [] : [{ from: restFrom, along: 'relations', count: rest.length }],
    )

  // each expansion is a view of the part asked for, under the same invariant (§6.5)
  const expand: Views['expand'] = ({ from, along }, options) => {
    const budget = options?.budget
    const offer = typeof from === 'string' ? byId.get(from) : undefined
    const fail = (): never => {
      throw new Error(`nothing to expand from ${JSON.stringify(from)} along ${along}`)
    }
    // the rest of the projection, from where the first view says it is
    if (along === 'relations' && restFrom !== undefined && from === restFrom)
      return page(ordered(whole(rest)), budget)
    let ids: OfferId[]
    switch (along) {
      case 'alternatives':
        ids = alternatives((offer ?? fail()).id)
        break
      case 'members': {
        const set = typeof from === 'string' ? sets.get(from) : undefined
        // a choice set is never shown in part, so expanding one returns all of it, whatever the budget
        return page(ordered((set ?? fail()).members), undefined)
      }
      case 'relations':
        if (offer) {
          const near = new Set(neighbors(offer.capability).map((n) => n.id))
          ids = args.offers.filter((o) => near.has(o.capability)).map((o) => o.id)
        } else if (
          typeof from === 'object' &&
          restFrom !== undefined &&
          typeof restFrom === 'object' &&
          sameRef(from, restFrom)
        ) {
          ids = rest
        } else return fail()
        break
      case 'enables': {
        const c = (offer ?? fail()).capability
        const to = new Set(
          edges.filter((e) => e.relation === 'enables' && e.from === c).map((e) => e.to),
        )
        ids = args.offers.filter((o) => to.has(o.capability)).map((o) => o.id)
        break
      }
      case 'contains': {
        if (typeof from !== 'object') return fail()
        const contains = new Set(manifest.resources.find((r) => r.id === from.type)?.contains ?? [])
        ids = args.offers.filter((o) => o.target && contains.has(o.target.type)).map((o) => o.id)
        break
      }
      case 'more':
        ids = (typeof from === 'string' ? sequences.get(from) : undefined) ?? fail()
        return page(ids, budget)
      default:
        return fail()
    }
    return page(ordered(whole(ids)), budget)
  }

  const inspect = (id: OfferId): OfferDetails | undefined => {
    const offer = byId.get(id)
    if (!offer) return
    const definition = manifest.capabilities.find((c) => c.id === offer.capability)!
    return {
      offer: { ...offer, relevance: relevance.get(id)! },
      definition,
      derived: derived
        .filter(
          (e) =>
            e.from === offer.capability &&
            (e.relation === 'enables' || e.relation === 'prerequisite'),
        )
        .map((e) => ({
          relation: e.relation as 'enables' | 'prerequisite',
          to: e.to,
          basis: e.basis,
          from: e.via.join(' '),
        })),
    }
  }

  return { view, expand, inspect }
}

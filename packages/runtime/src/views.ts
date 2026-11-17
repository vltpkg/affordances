import { base64url, canonicalJson, type CapabilityManifest, type Id } from '@affordances/ir'
import { words, type Facts } from './facts.ts'
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

// where a sequence of offers comes from (the first view, or one expansion), and a 'more' cursor: its origin and the
// budget of every cut since, under a projection revision, as base64url of its RFC 8785 text. Any projection of the
// same revision and request rebuilds the page, and the same view asked for twice has the same bytes (simplify C4)
type Origin =
  | { view: true }
  | { from: Expansion['from']; along: Exclude<Expansion['along'], 'more'> }
type Cursor = { r: string; o: Origin; b: (number | null)[] }
const encode = (cursor: Cursor) =>
  `more:${base64url(new TextEncoder().encode(canonicalJson(cursor)))}`
// a cursor's shape, checked whole: anything an agent sends is untrusted (review of C)
const ALONG = ['alternatives', 'members', 'relations', 'contains', 'enables']
const isRef = (v: unknown): v is ResourceRef =>
  v !== null &&
  typeof v === 'object' &&
  typeof (v as ResourceRef).type === 'string' &&
  typeof (v as ResourceRef).key === 'string'
const isOrigin = (o: unknown): o is Origin => {
  if (o === null || typeof o !== 'object' || Array.isArray(o)) return false
  const v = o as Record<string, unknown>
  if ('view' in v) return v.view === true && Object.keys(v).length === 1
  return (
    Object.keys(v).length === 2 &&
    (typeof v.from === 'string' || isRef(v.from)) &&
    ALONG.includes(v.along as string)
  )
}
const isCursor = (v: unknown): v is Cursor =>
  v !== null &&
  typeof v === 'object' &&
  typeof (v as Cursor).r === 'string' &&
  isOrigin((v as Cursor).o) &&
  Array.isArray((v as Cursor).b) &&
  (v as Cursor).b.every((n) => n === null || (Number.isInteger(n) && n > 0))

const decode = (from: unknown): Cursor | undefined => {
  if (typeof from !== 'string' || !from.startsWith('more:')) return
  try {
    const text = atob(from.slice(5).replaceAll('-', '+').replaceAll('_', '/'))
    const value = JSON.parse(
      new TextDecoder().decode(Uint8Array.from(text, (ch) => ch.charCodeAt(0))),
    )
    return isCursor(value) ? value : undefined
  } catch {
    return undefined
  }
}

export type Views = {
  view(): View
  expand(expansion: Pick<Expansion, 'from' | 'along'>, options?: { budget?: Budget }): View
  inspect(offer: OfferId): OfferDetails | undefined
}

// views over one projection's offers: what a policy shows first, and every expansion from there (§6)
export const views = (args: {
  manifest: CapabilityManifest
  facts: Facts
  request: ProjectionRequest
  policy: DiscoveryPolicy
  revision: string
  offers: CapabilityOffer[] // every offer the principal may see, in canonical order
  choiceSets: ChoiceSet[]
}): Views => {
  const { manifest, facts, request, policy, revision, choiceSets } = args
  const byId = new Map(args.offers.map((o) => [o.id, o]))
  const sets = new Map(choiceSets.map((s) => [s.id, s]))
  const start = request.start

  // relations between capabilities, declared and derived, both ways, found once for the manifest (simplify D1)
  const { derived, edges, neighbors, partners } = facts
  const byCapability = new Map<Id, OfferId[]>()
  for (const o of args.offers)
    byCapability.set(o.capability, [...(byCapability.get(o.capability) ?? []), o.id])

  // the start: an instance, whose offers target it or bind it as a reference, or a capability or a resource type
  const onStart = (o: CapabilityOffer) => {
    if (start === undefined) return false
    if (typeof start === 'string') return o.capability === start || o.target?.type === start
    return sameRef(o.target, start) || boundAs(o, start)
  }
  const boundAs = (o: CapabilityOffer, ref: ResourceRef) => {
    const c = facts.capability(o.capability)
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
    const own = facts.wordsOf(o.capability)
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

  // one page's split of a sequence: what fits the budget, choice sets whole; a set bigger than the budget is
  // summarized; the rest is cut, for the next page (§6.3)
  const split = (sequence: OfferId[], limit: number) => {
    const shown: OfferId[] = []
    const cut: OfferId[] = []
    const skippedSets = new Set<string>()
    const placed = new Set<OfferId>()
    const inSequence = new Set(sequence)
    for (const id of sequence) {
      if (placed.has(id)) continue
      const set = byId.get(id)!.choiceSet
      const group = set ? ordered(sets.get(set)!.members).filter((m) => inSequence.has(m)) : [id]
      for (const m of group) placed.add(m)
      if (shown.length + group.length <= limit) shown.push(...group)
      else if (set && group.length > limit) skippedSets.add(set)
      else cut.push(...group)
    }
    return { shown, cut, skippedSets }
  }

  // one page of a sequence, and the rest counted and expandable
  const page = (
    sequence: OfferId[],
    budget: Budget | undefined,
    chain: { o: Origin; b: (number | null)[] },
    extra: Expansion[] = [],
  ): View => {
    const { shown, cut, skippedSets } = split(sequence, budget?.offers ?? Infinity)
    const shownSet = new Set(shown)
    const expand: Expansion[] = [...extra]
    for (const set of skippedSets)
      expand.push({ from: set, along: 'members', count: sets.get(set)!.members.length })
    if (cut.length)
      expand.push({
        from: encode({ r: revision, o: chain.o, b: [...chain.b, budget?.offers ?? null] }),
        along: 'more',
        count: cut.length,
      })
    for (const id of shown) {
      const partnerOffers = alternatives(id)
      if (partnerOffers.some((x) => !shownSet.has(x)))
        expand.push({ from: id, along: 'alternatives', count: whole(partnerOffers).size })
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

  // every offer of an offer's alternativeTo partners, in canonical order
  const alternatives = (id: OfferId) =>
    [...partners(byId.get(id)!.capability)].flatMap((p) => byCapability.get(p) ?? [])

  // what's outside the scope is one expansion from the start, along its relations (§12's example). with no start
  // instance to name, it's from the first offer the view shows
  const rest = args.offers.filter((o) => !firstScope.has(o.id)).map((o) => o.id)
  const first = ordered(firstScope)
  const restFrom: Expansion['from'] | undefined = !rest.length
    ? undefined
    : typeof start === 'object'
      ? start
      : (first[0] ?? args.offers[0]!.id)
  const firstBudget = request.budget ?? policy.budget
  const view = () =>
    page(
      first,
      firstBudget,
      { o: { view: true }, b: [] },
      restFrom === undefined ? [] : [{ from: restFrom, along: 'relations', count: rest.length }],
    )

  // the sequence an origin pages through, or undefined when there's nothing to expand there
  const sequenceOf = (origin: Origin): { ids: OfferId[]; whole?: true } | undefined => {
    if ('view' in origin) return { ids: first }
    const { from, along } = origin
    const offer = typeof from === 'string' ? byId.get(from) : undefined
    // the rest of the projection, from where the first view says it is
    if (
      along === 'relations' &&
      restFrom !== undefined &&
      (from === restFrom ||
        (typeof from === 'object' && typeof restFrom === 'object' && sameRef(from, restFrom)))
    )
      return { ids: ordered(whole(rest)) }
    switch (along) {
      case 'alternatives':
        return offer && { ids: ordered(whole(alternatives(offer.id))) }
      case 'members': {
        const set = typeof from === 'string' ? sets.get(from) : undefined
        // a choice set is never shown in part, so expanding one returns all of it, whatever the budget
        return set && { ids: ordered(set.members), whole: true }
      }
      case 'relations': {
        if (!offer) return
        const near = new Set(neighbors(offer.capability).map((n) => n.id))
        return {
          ids: ordered(whole(args.offers.filter((o) => near.has(o.capability)).map((o) => o.id))),
        }
      }
      case 'enables': {
        if (!offer) return
        const to = new Set(
          edges
            .filter((e) => e.relation === 'enables' && e.from === offer.capability)
            .map((e) => e.to),
        )
        return {
          ids: ordered(whole(args.offers.filter((o) => to.has(o.capability)).map((o) => o.id))),
        }
      }
      case 'contains': {
        if (typeof from !== 'object') return
        const contains = new Set(facts.resource(from.type)?.contains ?? [])
        return {
          ids: ordered(
            whole(
              args.offers.filter((o) => o.target && contains.has(o.target.type)).map((o) => o.id),
            ),
          ),
        }
      }
      default:
        return
    }
  }

  // each expansion is a view of the part asked for, under the same invariant (§6.5)
  const expand: Views['expand'] = ({ from, along }, options) => {
    const budget = options?.budget
    const fail = (why = 'nothing to expand'): never => {
      throw new Error(`${why} from ${JSON.stringify(from)} along ${along}`)
    }
    if (along !== 'more') {
      const origin: Origin = { from, along }
      const found = sequenceOf(origin) ?? fail()
      return page(found.ids, found.whole ? undefined : budget, { o: origin, b: [] })
    }
    // 'more': rebuild the origin's sequence and replay each cut, under this projection's revision
    const cursor = decode(from) ?? fail()
    if (cursor.r !== revision) fail('a cursor from another revision')
    let ids = (sequenceOf(cursor.o) ?? fail()).ids
    // each cut takes at least one offer, so a cursor can't have more cuts than its sequence has offers (review of D)
    if (cursor.b.length > ids.length) fail()
    for (const offers of cursor.b) ids = split(ids, offers ?? Infinity).cut
    if (!ids.length) fail()
    return page(ids, budget, { o: cursor.o, b: cursor.b })
  }

  const inspect = (id: OfferId): OfferDetails | undefined => {
    const offer = byId.get(id)
    if (!offer) return
    const definition = facts.capability(offer.capability)!
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

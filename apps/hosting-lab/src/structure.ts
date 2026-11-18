// the S control (RFC 0003 §3.2): the same view, in a different structure. Its named transform, in two moves:
//   1. every choice set's member offers move out of the view's `offers` and into their choice set, in its order;
//   2. the view's other offers are grouped by their target's resource type, in the manifest's resource order
//      (offers with no target first), keeping A's order within each group.
// Nothing is added, dropped or relabelled. S states its own order truthfully (RFC 0002 R6): { by: 'group', key:
// 'targetType', within: A's basis }. That basis is structural, naming only a manifest-derived attribute, so it isn't
// information: sameInformation lets a claim-free basis differ, and fails any that names a claim, recommendation or
// source (intake, 2026-11-18). So S is information-constant, and checkably so: undoing the moves gives back A's view
// in the same arrangement. On this fixture the second move takes the
// add-on offers, which A's canonical order puts first, below the project's own

import { canonicalJson } from '@affordances/ir'
import { checkOrderBasis, claimFree, type ClaimFreeOrderBasis } from '@affordances/runtime'
import { manifest } from './manifest.ts'

type Offer = { id: string; target?: { type: string }; [field: string]: unknown }
type ChoiceSet = { id: string; members: string[]; [field: string]: unknown }
export type ViewData = { offers: Offer[]; choiceSets: ChoiceSet[]; [field: string]: unknown }

type NestedChoiceSet = { id: string; members: Offer[]; [field: string]: unknown }
export type NestedView = {
  offers: Offer[]
  choiceSets: NestedChoiceSet[]
  [field: string]: unknown
}

const inSets = (view: ViewData) => new Set(view.choiceSets.flatMap((c) => c.members))

// move 2: a stable grouping by the target's resource type, in the order the manifest declares its resources
const RESOURCES = manifest.resources.map((r) => r.id)
const rank = (o: Offer) => (o.target ? 1 + RESOURCES.indexOf(o.target.type) : 0)
const grouped = (offers: Offer[]) => offers.toSorted((a, b) => rank(a) - rank(b))
// S's order basis (RFC 0002 §6.4): grouped by target type, with A's order within each group
const groupedOrder = (within: unknown) =>
  ({ by: 'group', key: 'targetType', within }) as ClaimFreeOrderBasis

// an order basis that carries no claim, recommendation or source, only how the offers are arranged: the runtime's
// check (a known variant, no field it doesn't name, a group key from the closed set) and no claim anywhere in it
const structural = (order: unknown): boolean => {
  const checked = checkOrderBasis(order)
  return checked.ok && claimFree(checked.basis)
}

export const nestChoiceSets = (view: ViewData): NestedView => {
  const byId = new Map(view.offers.map((o) => [o.id, o]))
  const nested = inSets(view)
  return {
    ...view,
    order: groupedOrder(view.order),
    offers: grouped(view.offers.filter((o) => !nested.has(o.id))),
    choiceSets: view.choiceSets.map((c) => ({
      ...c,
      members: c.members.map((id) => {
        const offer = byId.get(id)
        if (!offer) throw new Error(`choice set ${c.id} names ${id}, which isn't in the view`)
        return offer
      }),
    })),
  }
}

// undo move 1: put the members back as ids, and their offers after the view's other offers. Move 2 needs no undoing
// to compare, since `arranged` puts A in the same grouping
export const unnestChoiceSets = (view: NestedView): ViewData => ({
  ...view,
  offers: [...view.offers, ...view.choiceSets.flatMap((c) => c.members)],
  choiceSets: view.choiceSets.map((c) => ({ ...c, members: c.members.map((o) => o.id) })),
})

// A's view in the same arrangement unnest produces: its other offers grouped, then each choice set's members
const arranged = (view: ViewData): ViewData => {
  const nested = inSets(view)
  const byId = new Map(view.offers.map((o) => [o.id, o]))
  return {
    ...view,
    offers: [
      ...grouped(view.offers.filter((o) => !nested.has(o.id))),
      ...view.choiceSets.flatMap((c) => c.members.map((id) => byId.get(id)!)),
    ],
  }
}

// whether an S rendering carries exactly A's information: undo the named transform, and compare as data. Any
// added label, claim, detail or field, or a changed order basis, makes it unequal
export const sameInformation = (a: ViewData, s: NestedView): boolean => {
  // S's own basis is structural if it's claim-free and S's grouping of A's: then it's set aside, as A's
  if (!structural(s.order) || canonicalJson(s.order) !== canonicalJson(groupedOrder(a.order)))
    return false
  return canonicalJson(arranged(a)) === canonicalJson(unnestChoiceSets({ ...s, order: a.order }))
}

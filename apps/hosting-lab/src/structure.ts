// the S control (RFC 0003 §3.2): the same view, in a different structure. Its named transform, in two moves:
//   1. every choice set's member offers move out of the view's `offers` and into their choice set, in its order;
//   2. the view's other offers are grouped by their target's resource type, in the manifest's resource order
//      (offers with no target first), keeping A's order within each group.
// Nothing is added, dropped or relabelled, and the order basis is A's. So S is information-constant, and checkably
// so: undoing the moves gives back A's view in the same arrangement. On this fixture the second move takes the
// add-on offers, which A's canonical order puts first, below the project's own

import { canonicalJson } from '@affordances/ir'
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

export const nestChoiceSets = (view: ViewData): NestedView => {
  const byId = new Map(view.offers.map((o) => [o.id, o]))
  const nested = inSets(view)
  return {
    ...view,
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
export const sameInformation = (a: ViewData, s: NestedView): boolean =>
  canonicalJson(arranged(a)) === canonicalJson(unnestChoiceSets(s))

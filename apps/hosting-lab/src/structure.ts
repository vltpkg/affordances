// the S control (RFC 0003 §3.2): the same view, in a different structure. Its one named transform: every choice
// set's member offers move out of the view's `offers` and into their choice set, in the choice set's order. Nothing
// is added, dropped or relabelled, and the order basis is A's. So S is information-constant, and checkably so

type Offer = { id: string; [field: string]: unknown }
type ChoiceSet = { id: string; members: string[]; [field: string]: unknown }
export type ViewData = { offers: Offer[]; choiceSets: ChoiceSet[]; [field: string]: unknown }

type NestedChoiceSet = { id: string; members: Offer[]; [field: string]: unknown }
export type NestedView = {
  offers: Offer[]
  choiceSets: NestedChoiceSet[]
  [field: string]: unknown
}

const inSets = (view: ViewData) => new Set(view.choiceSets.flatMap((c) => c.members))

export const nestChoiceSets = (view: ViewData): NestedView => {
  const byId = new Map(view.offers.map((o) => [o.id, o]))
  const nested = inSets(view)
  return {
    ...view,
    offers: view.offers.filter((o) => !nested.has(o.id)),
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

// undo exactly that transform: put the members back as ids, and their offers after the view's other offers
export const unnestChoiceSets = (view: NestedView): ViewData => ({
  ...view,
  offers: [...view.offers, ...view.choiceSets.flatMap((c) => c.members)],
  choiceSets: view.choiceSets.map((c) => ({ ...c, members: c.members.map((o) => o.id) })),
})

// A's view in the same arrangement unnest produces: its other offers in order, then each choice set's members
const arranged = (view: ViewData): ViewData => {
  const nested = inSets(view)
  const byId = new Map(view.offers.map((o) => [o.id, o]))
  return {
    ...view,
    offers: [
      ...view.offers.filter((o) => !nested.has(o.id)),
      ...view.choiceSets.flatMap((c) => c.members.map((id) => byId.get(id)!)),
    ],
  }
}

// whether an S rendering carries exactly A's information: undo the named transform, and compare as data. Any
// added label, claim, detail or field, or a changed order basis, makes it unequal
export const sameInformation = (a: ViewData, s: NestedView): boolean =>
  JSON.stringify(sortKeys(arranged(a))) === JSON.stringify(sortKeys(unnestChoiceSets(s)))

const sortKeys = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(sortKeys)
    : value !== null && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .toSorted()
            .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
        )
      : value

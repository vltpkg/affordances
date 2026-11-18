import * as lab from '@affordances/hosting-lab/trial'

// §2's deciding facts, as the agent could see them, one matcher per kind of result: the parity oracle's (step 7)
// and proAllowanceSeen's (surfaces/PLAN.md §5, the information path), so 'seen' means exactly what 'reachable' means.
// A structured result (protocol 1's JSON, v0's graph) shows a plan's fact when one object carries the plan's slug and
// the fact's own value side by side; the browser's matcher, the value in the same element as its label, is step 4's

/** A catalog plan's attributes, from the app's own resolver: the facts' values, never constants copied here. */
export const planAttributes = async (slug: string) => {
  const r = lab.resolvers['hosting.plan']!
  const nobody = { authenticated: false, attributes: {} }
  for (const key of (await r.list?.(nobody, { capability: 'hosting.plan.subscribe' })) ?? []) {
    const attributes = (await r.load(key, nobody))?.attributes as
      | Record<string, unknown>
      | undefined
    if (attributes?.slug === slug) return attributes
  }
  throw new Error(`the catalog has no plan ${slug}`)
}

/** Whether a structured result shows the plan's fact: some object holds slug and the fact's value together. */
export const showsFact = (result: unknown, slug: string, fact: string, value: unknown): boolean => {
  if (typeof result !== 'object' || result === null) return false
  const o = result as Record<string, unknown>
  if (!Array.isArray(o) && o.slug === slug && fact in o && o[fact] === value) return true
  return Object.values(o).some((v) => showsFact(v, slug, fact, value))
}

/** A tool's text as structured data when it's JSON, else nothing structured. */
export const structured = (text: unknown): unknown => {
  if (typeof text !== 'string') return text
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

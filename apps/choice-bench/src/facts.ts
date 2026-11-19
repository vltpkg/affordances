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

/**
 * Whether a structured result shows an item's fact: some object holds its slug and the fact's value together; or, for a
 * price, an offer targeting it (its target's key is the slug) whose rendered confirmation summary names the price, as
 * '5 USD', ffb00260's disclosure rule (an add-on's or bundle's price reaches the agent that way on protocol 1)
 */
export const showsFact = (result: unknown, slug: string, fact: string, value: unknown): boolean => {
  if (typeof result !== 'object' || result === null) return false
  const o = result as Record<string, unknown>
  if (!Array.isArray(o)) {
    if (o.slug === slug && fact in o && o[fact] === value) return true
    const target = o.target as { key?: unknown } | undefined
    const summary = (o.requirements as { confirmation?: { summary?: unknown } } | undefined)
      ?.confirmation?.summary
    if (
      fact === 'priceUsd' &&
      target?.key === slug &&
      typeof summary === 'string' &&
      holdsPhrase(summary, `${value} USD`)
    )
      return true
  }
  return Object.values(o).some((v) => showsFact(v, slug, fact, value))
}

/** A tool's text as JSON when it is, else the text itself: what a recorder keeps of a tool's output. */
export const parsedOrText = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
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

// the browser's matcher (design, 15:02Z): the agent's snapshot, Playwright's ARIA snapshot in 'ai' mode, read as a
// tree. A fact shows when the smallest node holding both its label (a node named exactly that: 'Pro', never 'Pro Plus'
// or 'Move to Pro') and its value as rendered holds no other label of the same kind (plan, add-on or bundle). A value
// node's own name or text holds the value as a whole phrase (design, 15:19Z): not preceded by a word character, $, a
// dot or a comma, and not followed by a word character. So '100 GB' is in '100 GB bandwidth', but not in '1,000 GB',
// and '$20 a month' isn't in '$120 a month'. A value read off another row, or off the add-on 'Extra bandwidth, 100 GB',
// doesn't count for Pro
export type AriaNode = { role: string; name?: string; text?: string; children: AriaNode[] }

const LINE = /^(\s*)- ([\w/-]+)(?: "((?:[^"\\]|\\.)*)")?((?: \[[^\]]*\])*)(?::(?: (.*))?)?$/
/** Playwright's ARIA snapshot as a tree, its [ref=…] and other bracketed annotations dropped. */
export const parseAria = (snapshot: string): AriaNode => {
  const root: AriaNode = { role: 'root', children: [] }
  const stack: { depth: number; node: AriaNode }[] = [{ depth: -1, node: root }]
  for (const line of snapshot.split('\n')) {
    const m = LINE.exec(line)
    if (!m) continue
    const depth = m[1]!.length / 2
    const node: AriaNode = { role: m[2]!, children: [] }
    if (m[3] !== undefined) node.name = m[3].replaceAll(/\\(.)/g, '$1')
    if (m[5] !== undefined && m[5] !== '') node.text = m[5].replace(/^"(.*)"$/, '$1')
    while (stack.at(-1)!.depth >= depth) stack.pop()
    stack.at(-1)!.node.children.push(node)
    stack.push({ depth, node })
  }
  return root
}

const escape = (s: string) => s.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** Whether text holds the value as a whole phrase, as a rendered value node does. */
export const holdsPhrase = (text: string, value: string) =>
  new RegExp(`(^|[^\\w$.,])${escape(value)}(?![\\w])`).test(text)
const named = (node: AriaNode, s: string) => node.name === s || node.text === s
const valued = (node: AriaNode, s: string) =>
  [node.name, node.text].some((t) => t !== undefined && holdsPhrase(t, s))
const holds = (node: AriaNode, s: string, match = named): boolean =>
  match(node, s) || node.children.some((c) => holds(c, s, match))

/** Whether the snapshot shows label's value, with no other label of its kind beside them. */
export const showsInTree = (
  tree: AriaNode,
  label: string,
  value: string,
  others: string[],
): boolean => {
  // the smallest node holding both: a child holding both is smaller, so it's found first
  const smallest = (node: AriaNode): AriaNode | undefined => {
    if (!holds(node, label) || !holds(node, value, valued)) return undefined
    for (const c of node.children) {
      const inner = smallest(c)
      if (inner) return inner
    }
    return node
  }
  const at = smallest(tree)
  return !!at && !others.some((o) => o !== label && holds(at, o))
}

// T8's facts are lists (results/surfaces-t8/PLAN.md §3 and §4): which plans a region serves, and which regions serve a
// plan. Each is compared whole, so a plan or region missing from one reads as absent, never as left unsaid
const sameList = (a: unknown, b: readonly string[]) =>
  Array.isArray(a) && a.length === b.length && a.every((x, i) => x === b[i])
const flatten = (node: AriaNode): AriaNode[] => [node, ...node.children.flatMap(flatten)]

/**
 * A region's plans in structured data, as a view shows them: an object for the region holding exactly these plans. A
 * comparison's row carries no key (RFC 0002 §6.6), so the region is named by its slug or its name.
 */
export const showsRegionPlans = (
  result: unknown,
  region: { slug: string; name: string },
  plans: readonly string[],
): boolean => {
  if (typeof result !== 'object' || result === null) return false
  const o = result as Record<string, unknown>
  if (
    !Array.isArray(o) &&
    (o.slug === region.slug || o.name === region.name) &&
    sameList(o.plans, plans)
  )
    return true
  return Object.values(o).some((v) => showsRegionPlans(v, region, plans))
}

/** A plan's regions in v0's graph for its page: the plan, and the slugs of exactly these regions it's served from. */
export const showsServedFrom = (
  result: unknown,
  plan: string,
  regions: readonly string[],
): boolean => {
  if (typeof result !== 'object' || result === null) return false
  const o = result as Record<string, unknown>
  const served = o.servedFrom
  if (
    !Array.isArray(o) &&
    (o.plan as { slug?: unknown } | undefined)?.slug === plan &&
    Array.isArray(served) &&
    sameList(
      served.map((r) => (r as { slug?: unknown }).slug),
      regions,
    )
  )
    return true
  return Object.values(o).some((v) => showsServedFrom(v, plan, regions))
}

/** A plan's page as the agent's snapshot shows it: its heading the plan's name, and its 'Served from' list exactly. */
export const pageShowsServedFrom = (tree: AriaNode, plan: string, items: readonly string[]) => {
  const nodes = flatten(tree)
  if (!nodes.some((n) => n.role === 'heading' && n.name === plan)) return false
  // the section holding the 'Served from' heading: Playwright's ai snapshot names no region by its aria-labelledby, so
  // the section is the node whose child is that heading, and its list the one beside it
  const section = nodes.find((n) =>
    n.children.some((c) => c.role === 'heading' && c.name === 'Served from'),
  )
  const list = section?.children.find((n) => n.role === 'list')
  return (
    !!list &&
    sameList(
      list.children.filter((c) => c.role === 'listitem').map((c) => c.text ?? c.name ?? ''),
      items,
    )
  )
}

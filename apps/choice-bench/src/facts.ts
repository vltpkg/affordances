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

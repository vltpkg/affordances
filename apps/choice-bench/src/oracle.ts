import * as lab from '@affordances/hosting-lab/trial'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { parseAria, showsFact, showsInTree, structured } from './facts.ts'
import type { SurfaceId } from './surfaces.ts'

// the information-parity oracle (surfaces/PLAN.md §2): before any trial, a walk through each surface's own tools, as the
// agent gets them, must reach every deciding fact. Every plan's price and bandwidthGb, the add-ons' prices and the
// bundle's price, each from the app's own resolvers. A surface that can't reach one is refused: its result would
// measure the gap, not the surface (M5's F lesson). For each fact found, the result it matched is kept, so a near-miss
// can be audited

export type Fact = {
  kind: 'plan' | 'addOn' | 'bundle'
  slug: string
  // the label a page shows for it, its catalog name
  name: string
  field: 'priceUsd' | 'bandwidthGb'
  value: number
  // as the pages render it (hosting-lab's usd and the plans page): 'Free', '$20 a month', '1,000 GB'
  rendered: string
}

const usd = (n: number) => (n === 0 ? 'Free' : `$${n} a month`)
const nobody = { authenticated: false, attributes: {} } as never

/** §2's deciding facts, from the app's own resolvers, never copied here. */
export const decidingFacts = async (): Promise<Fact[]> => {
  const facts: Fact[] = []
  for (const [kind, type, capability] of [
    ['plan', 'hosting.plan', 'hosting.plan.subscribe'],
    ['addOn', 'hosting.addOn', 'hosting.addOn.add'],
    ['bundle', 'hosting.bundle', 'hosting.bundle.subscribe'],
  ] as const) {
    const r = lab.resolvers[type]!
    for (const key of (await r.list?.(nobody, { capability })) ?? []) {
      const a = (await r.load(key, nobody))!.attributes as {
        slug: string
        name: string
        priceUsd: number
        bandwidthGb?: number
      }
      facts.push({
        kind,
        slug: a.slug,
        name: a.name,
        field: 'priceUsd',
        value: a.priceUsd,
        rendered: usd(a.priceUsd),
      })
      if (kind === 'plan')
        facts.push({
          kind,
          slug: a.slug,
          name: a.name,
          field: 'bandwidthGb',
          value: a.bandwidthGb!,
          rendered: `${a.bandwidthGb!.toLocaleString('en')} GB`,
        })
    }
  }
  return facts
}

export const factId = (f: Fact) => `${f.kind} ${f.slug} ${f.field}`

// one tool result the walk read: where it came from, and its text
export type Read = { where: string; text: string }

type View = {
  offers?: { id: string }[]
  choiceSets?: { members: (string | { id: string })[] }[]
  omitted?: { expand?: { from: unknown; along: string }[] }
}
const textOf = async (client: Client, name: string, args: Record<string, unknown> = {}) => {
  const r = (await client.callTool({ name, arguments: args })) as {
    content: { text?: string }[]
    isError?: boolean
  }
  return { text: r.content.map((c) => c.text ?? '').join(''), error: r.isError === true }
}

// the four generic tools' walk (full, progressive, MCP and WebMCP): the first view, every expansion it offers followed
// to the end, and inspect on every offer seen, ffb00260's walk on each surface's own tools
const walkViews = async (client: Client): Promise<Read[]> => {
  const reads: Read[] = []
  const offers = new Set<string>()
  const noteOffers = (v: View) => {
    for (const o of v.offers ?? []) offers.add(o.id)
    for (const c of v.choiceSets ?? [])
      for (const m of c.members) offers.add(typeof m === 'string' ? m : m.id)
  }
  const first = await textOf(client, 'project')
  reads.push({ where: 'project', text: first.text })
  const queue = [structured(first.text) as View]
  const expanded = new Set<string>()
  for (let view = queue.shift(); view; view = queue.shift()) {
    noteOffers(view)
    for (const e of view.omitted?.expand ?? []) {
      const key = JSON.stringify(e)
      if (expanded.has(key)) continue
      expanded.add(key)
      const r = await textOf(client, 'expand', { from: e.from, along: e.along })
      reads.push({ where: `expand ${key}`, text: r.text })
      if (!r.error) queue.push(structured(r.text) as View)
    }
  }
  for (const id of [...offers].toSorted()) {
    const r = await textOf(client, 'inspect', { offer: id })
    reads.push({ where: `inspect ${id}`, text: r.text })
  }
  return reads
}

// v0's walk: open every route in the SiteIndex, and read each graph. A route with a dynamic segment has no path of
// its own, so it's reached, if at all, through the static ones' nav
const walkV0 = async (client: Client, url: string): Promise<Read[]> => {
  const index = (await (await fetch(`${url}/.well-known/affordances.json`)).json()) as {
    routes?: { path?: string; route?: string }[]
  }
  const paths = [
    ...new Set(
      (index.routes ?? []).map((r) => r.path ?? r.route ?? '').filter((p) => p && !p.includes('[')),
    ),
  ]
  const reads: Read[] = []
  for (const path of paths.toSorted()) {
    const r = await textOf(client, 'affordances_open', { path })
    reads.push({ where: `open ${path}`, text: r.text })
  }
  return reads
}

// the browser's walk: every page reachable from the start by links, each read as the agent's snapshot
const walkBrowser = async (client: Client): Promise<Read[]> => {
  const reads: Read[] = []
  const seen = new Set<string>()
  const queue = ['/']
  for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
    if (seen.has(path)) continue
    seen.add(path)
    const r = await textOf(client, 'open', { path })
    reads.push({ where: `open ${path}`, text: r.text })
    // a link's target, as the snapshot lists it under the link
    for (const m of r.text.matchAll(/^\s*- \/url: (\/[^\s]*)$/gm)) {
      const next = m[1]!.split('#')[0]!
      if (!seen.has(next)) queue.push(next)
    }
  }
  return reads
}

export const walk = (surface: SurfaceId, client: Client, url: string) =>
  surface === 'v0'
    ? walkV0(client, url)
    : surface === 'browser'
      ? walkBrowser(client)
      : walkViews(client)

/** Where each fact was found in the reads, and which weren't, by the surface's own matcher (facts.ts). */
export const reached = (surface: SurfaceId, facts: Fact[], reads: Read[]) => {
  const labels = (kind: Fact['kind']) => [
    ...new Set(facts.filter((f) => f.kind === kind).map((f) => f.name)),
  ]
  const trees =
    surface === 'browser' ? reads.map((r) => ({ where: r.where, tree: parseAria(r.text) })) : []
  const data =
    surface === 'browser' ? [] : reads.map((r) => ({ where: r.where, value: structured(r.text) }))
  const found: { fact: string; where: string }[] = []
  const missing: string[] = []
  for (const f of facts) {
    const hit =
      surface === 'browser'
        ? trees.find((t) => showsInTree(t.tree, f.name, f.rendered, labels(f.kind)))
        : data.find((d) => showsFact(d.value, f.slug, f.field, f.value))
    if (hit) found.push({ fact: factId(f), where: hit.where })
    else missing.push(factId(f))
  }
  return { found, missing }
}

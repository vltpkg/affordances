import * as lab from '@affordances/hosting-lab/trial'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { regions, plans as catalogPlans } from '@affordances/hosting-lab/catalog'
import {
  pageShowsServedFrom,
  parseAria,
  showsFact,
  showsInTree,
  showsRegionPlans,
  showsServedFrom,
  structured,
} from './facts.ts'
import type { SurfaceId } from './surfaces.ts'

// the information-parity oracle (surfaces/PLAN.md §2): before any trial, a walk through each surface's own tools, as the
// agent gets them, must reach every deciding fact. Every plan's price and bandwidthGb, the add-ons' prices and the
// bundle's price, each from the app's own resolvers. A surface that can't reach one is refused: its result would
// measure the gap, not the surface (M5's F lesson). For each fact found, the result it matched is kept, so a near-miss
// can be audited

export type Fact = PriceFact | RegionFact | ServedFromFact
export type PriceFact = {
  kind: 'plan' | 'addOn' | 'bundle'
  slug: string
  // the label a page shows for it, its catalog name
  name: string
  field: 'priceUsd' | 'bandwidthGb'
  value: number
  // as the pages render it (hosting-lab's usd and the plans page): 'Free', '$20 a month', '1,000 GB'
  rendered: string
}
// T8's (results/surfaces-t8/PLAN.md §4): on the graph surfaces, each region's plans, a complete list
type RegionFact = { kind: 'region'; slug: string; name: string; field: 'plans'; plans: string[] }
// and on the pages, each plan's page listing exactly its regions: their slugs in v0's graph, and their text on the page
type ServedFromFact = {
  kind: 'servedFrom'
  slug: string
  name: string
  field: 'regions'
  regions: string[]
  items: string[]
}

// a plan's regions as its page lists them, in the catalog's order: 'US East (US)'
const servedFromOf = (plan: string) => {
  const served = regions.filter((r) => r.plans.includes(plan as never))
  return {
    regions: served.map((r) => r.slug),
    items: served.map((r) => `${r.name} (${r.jurisdiction})`),
  }
}

/** T8's deciding facts, from the catalog: every region's plans, and every plan's page of regions. */
const t8Facts = (): Fact[] => [
  ...regions.map((r) => ({
    kind: 'region' as const,
    slug: r.slug,
    name: r.name,
    field: 'plans' as const,
    plans: [...r.plans],
  })),
  ...catalogPlans.map((p) => ({
    kind: 'servedFrom' as const,
    slug: p.slug,
    name: p.name,
    field: 'regions' as const,
    ...servedFromOf(p.slug),
  })),
]

/**
 * T8's regionSeen (PLAN §5, as clarified): the one fact that rules the favored option out, as a complete list, by the
 * walk's own matchers. On the graph surfaces, EU West's region with plans exactly ['business']; on v0, the graph for
 * Pro's page with exactly its regions' slugs; in the browser, Pro's page listing exactly 'US East (US)'.
 */
export const regionSeenIn = (surface: SurfaceId, output: unknown): boolean =>
  READERS[surface].regionSeen(output)

const usd = (n: number) => (n === 0 ? 'Free' : `$${n} a month`)
const nobody = { authenticated: false, attributes: {} } as never

/** §2's deciding facts, from the app's own resolvers, never copied here. */
export const decidingFacts = async (task?: string): Promise<Fact[]> => {
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
  // T8's are its own: no other task's walk asks for them
  return task === 'T8' ? [...facts, ...t8Facts()] : facts
}

export const factId = (f: Fact) => `${f.kind} ${f.slug} ${f.field}`

// whether a fact is one this surface must reach: a region's plans on the graph surfaces, a plan's page on the others
const appliesTo = (f: Fact, surface: SurfaceId) =>
  f.kind === 'region'
    ? READERS[surface].graph
    : f.kind === 'servedFrom'
      ? !READERS[surface].graph
      : true

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
// its own, so it's reached, if at all, through the graphs' nav, which the walk follows
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
  // then each graph's nav, as an agent follows it: a dynamic route's pages, T8's plan pages among them, are reached so
  const queue = paths.toSorted()
  const seen = new Set<string>()
  for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
    if (seen.has(path)) continue
    seen.add(path)
    const r = await textOf(client, 'affordances_open', { path })
    reads.push({ where: `open ${path}`, text: r.text })
    const nav = (structured(r.text) as { nav?: { to?: unknown }[] } | undefined)?.nav ?? []
    for (const n of nav)
      if (typeof n.to === 'string' && n.to.startsWith('/') && !seen.has(n.to)) queue.push(n.to)
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

type PlanPage = { name: string; slug: string; regions: string[]; items: string[] }

// how a surface's reads are matched (facts.ts): the graph surfaces' views and v0's pages as JSON, the browser's
// snapshots as a tree. Each surface names one, and the walk, the matchers and the depth check ask it
type Reader = {
  // a region's plans are the graph surfaces' fact; a plan's page of regions is the pages'
  graph: boolean
  walk: (client: Client, url: string) => Promise<Read[]>
  parse: (text: string) => unknown
  // whether one tool output shows T8's deciding fact
  regionSeen: (output: unknown) => boolean
  price: (read: unknown, f: PriceFact, labels: string[]) => boolean
  // a plan's page, listing exactly its regions
  servedFrom: (read: unknown, p: PlanPage) => boolean
  // whether the plans page links to a plan's page
  links: (plansPage: string, slug: string) => boolean
}

const euWest = () => regions.find((r) => r.slug === 'eu-west')!
const navLinks = (plansPage: string, slug: string) =>
  ((structured(plansPage) as { nav?: { to?: string }[] } | undefined)?.nav ?? []).some(
    (n) => n.to === `/plans/${slug}`,
  )
const json = {
  parse: structured,
  price: (read: unknown, f: PriceFact) => showsFact(read, f.slug, f.field, f.value),
  servedFrom: (read: unknown, p: PlanPage) => showsServedFrom(read, p.slug, p.regions),
  links: navLinks,
}
const views: Reader = {
  ...json,
  graph: true,
  walk: (client) => walkViews(client),
  regionSeen: (output) => showsRegionPlans(output, euWest(), [...euWest().plans]),
}
const pages: Reader = {
  ...json,
  graph: false,
  walk: walkV0,
  regionSeen: (output) => showsServedFrom(output, 'pro', servedFromOf('pro').regions),
}
const tree: Reader = {
  graph: false,
  walk: (client) => walkBrowser(client),
  parse: parseAria,
  regionSeen: (output) =>
    typeof output === 'string' &&
    pageShowsServedFrom(
      parseAria(output),
      catalogPlans.find((p) => p.slug === 'pro')!.name,
      servedFromOf('pro').items,
    ),
  price: (read, f, labels) =>
    showsInTree(read as ReturnType<typeof parseAria>, f.name, f.rendered, labels),
  servedFrom: (read, p) =>
    pageShowsServedFrom(read as ReturnType<typeof parseAria>, p.name, p.items),
  links: (plansPage, slug) => plansPage.includes(`/url: /plans/${slug}`),
}
const READERS: Record<SurfaceId, Reader> = {
  full: views,
  progressive: views,
  mcp: views,
  webmcp: views,
  v0: pages,
  browser: tree,
}

/** Whether a surface reads views (the graph surfaces), rather than pages. */
export const readsViews = (surface: SurfaceId) => READERS[surface].graph

export const walk = (surface: SurfaceId, client: Client, url: string) =>
  READERS[surface].walk(client, url)

/** Where each fact was found in the reads, and which weren't, by the surface's own matcher (facts.ts). */
export const reached = (surface: SurfaceId, facts: Fact[], reads: Read[]) => {
  const reader = READERS[surface]
  const labels = (kind: Fact['kind']) => [
    ...new Set(facts.filter((f) => f.kind === kind).map((f) => f.name)),
  ]
  const matches = (f: Fact, value: unknown) =>
    f.kind === 'region'
      ? showsRegionPlans(value, f, f.plans)
      : f.kind === 'servedFrom'
        ? reader.servedFrom(value, f)
        : reader.price(value, f, labels(f.kind))
  const parsed = reads.map((r) => ({ where: r.where, value: reader.parse(r.text) }))
  const found: { fact: string; where: string }[] = []
  const missing: string[] = []
  for (const f of facts.filter((x) => appliesTo(x, surface))) {
    const hit = parsed.find((d) => matches(f, d.value))
    if (hit) found.push({ fact: factId(f), where: hit.where })
    else missing.push(factId(f))
  }
  return { found, missing }
}

// whether a result holds every region's plans, each a complete list
const allRegions = (value: unknown) =>
  regions.every((r) => showsRegionPlans(value, r, [...r.plans]))

// the depth checks: full's and progressive's first views, and every other surface's pages
type Depth = (reads: Read[], first: Read, offers: string[]) => { ok: boolean; detail: string }
const fullDepth: Depth = (_, first, offers) => {
  const v = structured(first.text) as
    | { choiceSets?: { id: string; comparison?: { omitted?: { attributes?: string[] } } }[] }
    | undefined
  const set = v?.choiceSets?.find((c) => c.id.startsWith('hosting.region.read@'))
  const ok =
    offers.every((o) => first.text.includes(o)) &&
    allRegions(v) &&
    (set?.comparison?.omitted?.attributes ?? ['missing']).length === 0
  return {
    ok,
    detail: ok
      ? 'both regions and their plans in the first view, nothing omitted'
      : 'the first view lacks a region, its plans, or omits a column',
  }
}
const progressiveDepth: Depth = (reads, first, offers) => {
  const v = structured(first.text) as
    | { omitted?: { expand?: { from: unknown; along: string }[] } }
    | undefined
  const listed = (v?.omitted?.expand ?? []).filter((e) => e.along === 'relations')
  const hidden =
    !offers.some((o) => first.text.includes(o)) &&
    !first.text.includes('hosting.region.read@hosting.region"')
  const opened = reads.find(
    (r) =>
      r.where.startsWith('expand ') &&
      listed.some((e) => r.where === `expand ${JSON.stringify(e)}`) &&
      allRegions(structured(r.text)),
  )
  const ok =
    hidden && listed.length === 1 && !!opened && offers.every((o) => opened.text.includes(o))
  return {
    ok,
    detail: ok
      ? 'no region in the first view; its one relations expansion returns both'
      : `the first view shows a region, lists ${listed.length} relations expansions, or none returns both regions`,
  }
}
const pageDepth =
  (reader: Reader): Depth =>
  (reads, first) => {
    const items = catalogPlans.map((p) => ({ ...p, ...servedFromOf(p.slug) }))
    const onPage = (r: Read, p: (typeof items)[number]) =>
      reader.servedFrom(reader.parse(r.text), p)
    const plansPage = reads.find((r) => r.where === 'open /plans')
    const linked = (p: (typeof items)[number]) =>
      !!plansPage && reader.links(plansPage.text, p.slug)
    const firstHides = !items.some((p) => onPage(first, p))
    const reachable = items.every(
      (p) => linked(p) && reads.some((r) => r.where === `open /plans/${p.slug}` && onPage(r, p)),
    )
    const ok = firstHides && reachable
    return {
      ok,
      detail: ok
        ? "no plan's regions on the first page; each plan's page is one link from /plans"
        : 'the first page shows regions, or a plan page is unlinked from /plans or lacks its regions',
    }
  }
const DEPTH: Partial<Record<SurfaceId, Depth>> = { full: fullDepth, progressive: progressiveDepth }

/**
 * T8's depth check (results/surfaces-t8/PLAN.md §4), mechanical, on the walk's reads: the deciding fact is one step
 * out, as the plan states it, or the run is refused and the fixture goes back to review and intake.
 * - full: both region offers, and the region set with each region's plans in its comparison, in the first view, with
 *   nothing omitted from that comparison;
 * - progressive: no region offer and no region set in the first view, and the one expansion it lists along
 *   relations returns both region offers and each region's plans;
 * - v0 and browser: no plan's regions on the first page opened, and each plan's page one link from the plans page,
 *   listing exactly its regions.
 */
export const t8Depth = (surface: SurfaceId, reads: Read[]): { ok: boolean; detail: string } => {
  const offers = regions.map((r) => `hosting.region.read@hosting.region:${r.slug}`)
  const first = reads[0]
  if (!first) return { ok: false, detail: 'the walk read nothing' }
  return (DEPTH[surface] ?? pageDepth(READERS[surface]))(reads, first, offers)
}

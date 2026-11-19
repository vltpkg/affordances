import * as lab from '@affordances/hosting-lab/trial'
import { expect, test } from 'vitest'
import { decidingFacts, reached, type PriceFact, type Read } from '../src/oracle.ts'
import { refusalsOf, type SurfaceCheck } from '../src/preflight.ts'
import { surfacePromptFor } from '../src/surface.ts'
import { surfaces } from '../src/surfaces.ts'

// M7f's preflight (surfaces/PLAN.md §2): the parity oracle's matching, and every check refusing its failing case

test('the deciding facts are the app’s own: every plan’s price and bandwidth, every add-on’s and bundle’s price', async () => {
  const facts = (await decidingFacts()) as PriceFact[]
  expect(
    facts
      .filter((f) => f.kind === 'plan')
      .map((f) => `${f.slug} ${f.field}`)
      .toSorted(),
  ).toEqual(
    ['business', 'hobby', 'pro'].flatMap((s) => [`${s} bandwidthGb`, `${s} priceUsd`]).toSorted(),
  )
  expect(facts.filter((f) => f.kind === 'addOn')).toHaveLength(3)
  expect(facts.filter((f) => f.kind === 'bundle')).toHaveLength(1)
  expect(facts.find((f) => f.slug === 'hobby' && f.field === 'priceUsd')!.rendered).toBe('Free')
  expect(facts.find((f) => f.slug === 'business' && f.field === 'bandwidthGb')!.rendered).toBe(
    '1,000 GB',
  )
})

// a structured read that shows every fact, and one with a fact removed
const allFacts = async (): Promise<Read[]> => {
  const facts = (await decidingFacts()) as PriceFact[]
  // one row per item of a kind: its slug and each of its facts' values
  const rows = (kind: string) => {
    const bySlug = new Map<string, Record<string, unknown>>()
    for (const f of facts.filter((x) => x.kind === kind))
      bySlug.set(f.slug, { ...(bySlug.get(f.slug) ?? { slug: f.slug }), [f.field]: f.value })
    return [...bySlug.values()]
  }
  return [
    {
      where: 'project',
      text: JSON.stringify({ plans: rows('plan'), addOns: rows('addOn'), bundles: rows('bundle') }),
    },
  ]
}

test('the oracle finds every fact a surface shows, and a surface with a fact removed is refused', async () => {
  const facts = (await decidingFacts()) as PriceFact[]
  const full = reached('full', facts, await allFacts())
  expect(full.missing).toEqual([])
  expect(full.found.every((f) => f.where === 'project')).toBe(true)
  // Pro's bandwidth gone from what the surface shows
  const [read] = await allFacts()
  const without = JSON.parse(read!.text)
  delete without.plans.find((p: { slug: string }) => p.slug === 'pro').bandwidthGb
  const short = reached('full', facts, [{ where: 'project', text: JSON.stringify(without) }])
  expect(short.missing).toEqual(['plan pro bandwidthGb'])
  expect(
    refusalsOf([check({ surface: 'full', missing: short.missing })], [prompt('full')]),
  ).toEqual(["full: the oracle's walk can't reach plan pro bandwidthGb"])
})

test('the browser’s oracle reads snapshots by design’s tree rule, never a value off another row', async () => {
  const facts = ((await decidingFacts()) as PriceFact[]).filter((f) => f.kind === 'plan')
  const snapshot = ['Hobby', 'Pro', 'Business']
    .map((name) => {
      const f = (field: string) => facts.find((x) => x.name === name && x.field === field)!.rendered
      return `  - listitem:\n    - heading "${name}" [level=2]\n    - paragraph: ${f('priceUsd')}\n    - listitem: ${f('bandwidthGb')} bandwidth`
    })
    .join('\n')
  const page = `- main:\n  - list:\n${snapshot.replaceAll('\n  ', '\n    ').replace(/^  /, '    ')}`
  expect(reached('browser', facts, [{ where: 'open /plans', text: page }]).missing).toEqual([])
  // Pro's row without its bandwidth: Business's '1,000 GB' or Hobby's '10 GB' never count for it
  const cut = page.replace(
    /(heading "Pro"[^\n]*\n(?:[^\n]*\n)*?)\s*- listitem: 100 GB bandwidth\n?/,
    '$1',
  )
  expect(reached('browser', facts, [{ where: 'open /plans', text: cut }]).missing).toEqual([
    'plan pro bandwidthGb',
  ])
})

const check = (over: Partial<SurfaceCheck>): SurfaceCheck => ({
  surface: 'full',
  buildId: 'b1',
  siteIndex: 's1',
  instructions: null,
  toolsHash: 'h',
  tools: ['execute', 'expand', 'inspect', 'project'],
  firstView: 'project',
  found: [],
  missing: [],
  ...over,
})
const prompt = (s: keyof typeof surfaces) =>
  surfacePromptFor(
    surfaces[s],
    lab.tasks.find((t) => t.id === 'T6')!,
  )

test('a clean run passes; each failing check is refused, by name', () => {
  const ok = [check({ surface: 'full' }), check({ surface: 'v0', firstView: 'pages' })]
  expect(refusalsOf(ok, [prompt('full'), prompt('v0')])).toEqual([])
  const one = (c: Partial<SurfaceCheck>) =>
    refusalsOf(
      [check({ surface: 'full' }), check({ surface: 'mcp', ...c })],
      [prompt('full'), prompt('mcp')],
    )
  expect(one({ instructions: 'Use the tools.' })).toEqual(['mcp: its server sends instructions'])
  expect(one({ firstView: 'site-wide' })).toEqual([
    "mcp: its first view isn't from the user's project",
  ])
  expect(one({ buildId: 'b2' })).toEqual(['the cells differ in the build id: b1 / b2'])
  expect(one({ siteIndex: 's2' })).toEqual(['the cells differ in the served SiteIndex: s1 / s2'])
  expect(
    refusalsOf(
      [
        check({
          surface: 'browser',
          browser: { chromium: '156.0.1', playwright: '1.64.1', launchArgs: [] },
        }),
        check({
          surface: 'webmcp',
          browser: {
            chromium: '157.0.1',
            playwright: '1.64.1',
            launchArgs: ['--enable-features=WebMCP'],
          },
        }),
      ],
      [prompt('browser'), prompt('webmcp')],
    ),
  ).toEqual(['the cells differ in the browser: 156.0.1 1.64.1 / 157.0.1 1.64.1'])
  // a prompt that differs anywhere but its instruction line
  expect(
    refusalsOf(
      [check({ surface: 'full' }), check({ surface: 'v0', firstView: 'pages' })],
      [prompt('full'), `${prompt('v0')} Hurry.`],
    ),
  ).toEqual(['v0: its prompt differs beyond its instruction line'])
  // packages/mcp other than main's
  expect(
    refusalsOf([check({})], [prompt('full')], {
      commit: 'e9645ab4',
      files: 12,
      ok: false,
      differ: [{ file: 'packages/mcp/src/server.ts', reason: 'differs' }],
    }),
  ).toEqual(["packages/mcp isn't main's e9645ab4: packages/mcp/src/server.ts differs"])
})

// the planner (00:04Z): the pinned preflight runs a fake T8 trial per surface, and refuses unless each one's metrics
// carry regionSeen as a boolean
test('a T8 fake trial whose metrics lack a boolean regionSeen refuses the run, naming its surface', () => {
  const records = [
    { surface: 'full' as const, regionSeen: true },
    { surface: 'v0' as const, regionSeen: false },
    { surface: 'browser' as const, regionSeen: undefined },
  ]
  expect(refusalsOf([], [], undefined, undefined, records)).toEqual([
    "browser: a T8 trial's metrics have no regionSeen",
  ])
  expect(refusalsOf([], [], undefined, undefined, records.slice(0, 2))).toEqual([])
})

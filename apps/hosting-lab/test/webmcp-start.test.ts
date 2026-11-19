import { registerWebMcp } from '@affordances/webmcp'
import { beforeEach, expect, test } from 'vitest'
import * as serve from '../src/lib/serve.ts'
import * as store from '../src/lib/store.ts'

// the page's start for WebMCP (intake, 2026-11-18 16:28Z): the first view starts from the page's resource, the
// person's own project, as full's does. A start is a VIEW parameter only and grants nothing: these run the page's
// tools against hosting-lab's own projection route, in process, as one session

beforeEach(() => store.reset())

const origin = 'https://hosting.test'
type Tool = {
  name: string
  execute: (args: Record<string, unknown>) => Promise<{ content: { text: string }[] }>
}

// the page's tools, as a browser registers them, calling the real route as the session `sid`
const tools = (sid: string, start?: { type: string; key: string }) => {
  const registered: Tool[] = []
  const fetcher = (async (url: string, init?: RequestInit) => {
    const request = new Request(new URL(url, origin), {
      ...init,
      headers: { ...(init?.headers as Record<string, string>), authorization: `Bearer ${sid}` },
    })
    return (init?.method ?? 'GET') === 'POST' ? serve.POST(request) : serve.GET(request)
  }) as typeof fetch
  registerWebMcp({
    base: '/api/projection',
    ask: async () => true,
    view: { policy: 'exhaustive' },
    context: { registerTool: (t: Tool) => void registered.push(t) },
    fetcher,
    ...(start && { start }),
  })
  const call = async (name: string, args: Record<string, unknown> = {}) =>
    JSON.parse(
      (await registered.find((t) => t.name === name)!.execute(args)).content
        .map((c) => c.text)
        .join(''),
    ) as Record<string, unknown>
  return { call }
}

type Offer = { id: string; capability: string; availability: { status: string } }
const offersOf = (view: Record<string, unknown>) => view.offers as Offer[]
const own = (sid: string) => ({ type: 'hosting.project', key: store.account(sid).project.id })

// the plan offers a first view holds, from a start, by plan slug
const plansOf = async (start?: { type: string; key: string }) =>
  offersOf(await tools('s_a', start).call('project')).filter(
    (o) => o.capability === 'hosting.plan.subscribe',
  )
const statusBySlug = (offers: Offer[]) =>
  Object.fromEntries(
    offers.map((o) => [
      store.currentPlans().find((p) => o.id.includes(`hosting.plan:${p.id}`))!.slug,
      o.availability.status,
    ]),
  )

test("from the page's own start, the first view offers every other plan as available, as full's does", async () => {
  const current = store.account('s_a').project.plan
  const fromOwn = statusBySlug(await plansOf(own('s_a')))
  // the project's own plan can't be bought again; every other plan can
  expect(fromOwn).toEqual(
    Object.fromEntries(
      store.currentPlans().map((p) => [p.slug, p.slug === current ? 'unavailable' : 'available']),
    ),
  )
  // site-wide, with no start, no plan is available yet: that's why the page gives one (backend, 16:27Z)
  const siteWide = await plansOf()
  expect(siteWide.filter((o) => o.availability.status === 'available')).toEqual([])
})

test("a start naming another person's project grants nothing: no offer the session couldn't otherwise get", async () => {
  const theirs = own('s_b')
  const ownView = offersOf(await tools('s_a', own('s_a')).call('project'))
  const siteWide = offersOf(await tools('s_a').call('project'))
  const theirView = await tools('s_a', theirs).call('project')
  const fromTheirs = offersOf(theirView)
  // their project appears nowhere in the view: a start that isn't the session's own grants it nothing to see
  expect(fromTheirs.filter((x) => x.id.includes(theirs.key))).toEqual([])
  expect(JSON.stringify(theirView)).not.toContain(theirs.key)
  // the view isn't empty, so what follows checks something: the session's own offers and the site-wide ones
  expect(fromTheirs.filter((x) => x.availability.status === 'available').length).toBeGreaterThan(0)
  // and every offer it can act on is one it gets anyway, from its own start or site-wide
  const anyway = new Set([...ownView, ...siteWide].map((o) => o.id))
  for (const o of fromTheirs.filter((x) => x.availability.status === 'available'))
    expect(anyway).toContain(o.id)
})

test("execution on another person's project is still refused, whatever the start, and changes nothing", async () => {
  const theirs = own('s_b')
  const before = structuredClone({
    plan: store.account('s_b').project.plan,
    ledger: store.account('s_b').ledger,
  })
  const t = tools('s_a', theirs)
  const plan = store.currentPlans().find((p) => p.slug === 'pro')!
  const offer = `hosting.plan.subscribe@hosting.plan:${plan.id}?project=${theirs.key}`
  const result = await t.call('execute', { offer, input: { plan: plan.id, projectId: theirs.key } })
  expect(result.status).toBe('refused')
  expect(result.code).not.toBe('confirmation_required')
  expect({ plan: store.account('s_b').project.plan, ledger: store.account('s_b').ledger }).toEqual(
    before,
  )
})

import * as lab from '@affordances/hosting-lab/trial'
import { expect, test } from 'vitest'
import { conditions, type ConditionId } from '../src/conditions.ts'
import { createTools } from '../src/tools.ts'
import { setupTrial } from '../src/trial.ts'

// the generalized disclosure check (the planner, 2026-11-18, after the pilot's add-on price gap): in EVERY condition, with
// its own policy, request and manifest, and S's rendering, every offer of a financial capability shows its amount to the
// agent. The agent gets it in a view, an expansion, or inspect, and its confirmation summary never renders 'unknown'.
// The financial capabilities are derived from each condition's manifest's effects, never listed by hand

type Offer = {
  id: string
  capability: string
  target?: { type: string; key: string }
  requirements: { confirmation?: { summary: string } }
}
type View = {
  offers: Offer[]
  choiceSets: { members: (string | Offer)[] }[]
  omitted: { expand: { from: unknown; along: string }[] }
}
const offersOf = (v: View): Offer[] => [
  ...v.offers,
  ...v.choiceSets.flatMap((c) => c.members.filter((m): m is Offer => typeof m === 'object')),
]

// the condition's own task, and T6 and T7
const TASKS: Record<ConditionId, string[]> = {
  A: ['T3', 'T6', 'T7'],
  B: ['T3', 'T6', 'T7'],
  C: ['T3', 'T6', 'T7'],
  D: ['T3', 'T6', 'T7'],
  E: ['T3', 'T6', 'T7'],
  F: ['T1', 'T6', 'T7'],
  G: ['T1', 'T6', 'T7'],
  S: ['T3', 'T6', 'T7'],
  'C-full-scope': ['T3', 'T6', 'T7'],
  'A-scope': ['T3', 'T6', 'T7'],
}

const check = async ([id, taskId]: [ConditionId, string]) => {
  const condition = conditions[id]
  const task = lab.tasks.find((t) => t.id === taskId)!
  const trial = await setupTrial(condition, 0, taskId)
  const financial = new Set(
    trial.runtime.manifest.capabilities
      .filter((c) => (c.effects ?? []).some((e) => e.category === 'financial'))
      .map((c) => c.id),
  )
  expect(financial.size).toBeGreaterThan(0)
  const tools = createTools(trial, condition, task)
  // everything the agent's tools can show: the first view, and every expansion it offers, followed to the end
  const seen = new Map<string, string[]>()
  const note = (o: Offer, where: string) =>
    financial.has(o.capability) &&
    seen.set(o.id, [...(seen.get(o.id) ?? []), `${where}: ${o.requirements.confirmation?.summary}`])
  const queue = [JSON.parse((await tools.call('project')).text) as View]
  const expanded = new Set<string>()
  for (let view = queue.shift(); view; view = queue.shift()) {
    for (const o of offersOf(view)) note(o, 'view')
    for (const e of view.omitted.expand) {
      const key = JSON.stringify(e)
      if (expanded.has(key)) continue
      expanded.add(key)
      const r = await tools.call('expand', { from: e.from, along: e.along })
      if (!r.error) queue.push(JSON.parse(r.text) as View)
    }
  }
  // every financial offer in the projection is reachable, and inspect shows it in full
  const projection = await trial.runtime.project({ principal: trial.principal, ...trial.request })
  const all = projection.offers.filter((o) => financial.has(o.capability))
  expect(all.length).toBeGreaterThan(0)
  const problems: string[] = []
  for (const offer of all) {
    const inspected = JSON.parse((await tools.call('inspect', { offer: offer.id })).text) as {
      offer: Offer
    }
    note(inspected.offer, 'inspect')
    const target = offer.target
      ? await lab.resolvers[offer.target.type]!.load(offer.target.key, trial.principal)
      : null
    const price = (target?.attributes as { priceUsd?: number } | undefined)?.priceUsd
    const summaries = seen.get(offer.id) ?? []
    if (summaries.some((s) => s.includes('unknown')))
      problems.push(`${offer.id}: ${summaries.find((s) => s.includes('unknown'))}`)
    if (price === undefined) problems.push(`${offer.id}: its target has no price`)
    else if (!summaries.some((s) => s.includes(`${price} USD`)))
      problems.push(`${offer.id}: no summary names ${price} USD`)
  }
  expect(problems).toEqual([])
}

const cases = Object.entries(TASKS).flatMap(([c, tasks]) =>
  tasks.map((t) => [c, t] as [ConditionId, string]),
)
const NAME = 'every financial offer shows its amount to the agent, and none renders unknown'
// every condition, G included: G's summary renders its default and lists the default add-on's charges, now that the
// runtime applies input defaults and lists every charge (intake, 2026-11-18)
for (const c of cases)
  test(`${c[0]} on ${c[1]}: ${NAME}`, async () => {
    await expect(check(c)).resolves.toBeUndefined()
  })

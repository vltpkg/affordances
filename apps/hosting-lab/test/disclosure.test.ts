import { builtInPolicies } from '@affordances/runtime'
import { beforeEach, expect, test } from 'vitest'
import { principalFor, resolvers } from '../src/lib/resolvers.ts'
import { runtime } from '../src/lib/runtime.ts'
import * as store from '../src/lib/store.ts'
import { manifest } from '../src/manifest.ts'

// every offer that costs money shows what it costs, in every view an agent can get and in inspect: its
// confirmation summary renders, with no `unknown`, and names the target's price. The set is derived from the
// manifest's effects, never listed by hand (the M5 pilot's F finding: the add-on's price never reached an agent)

beforeEach(() => store.reset())

const financial = new Set(
  manifest.capabilities
    .filter((c) => (c.effects ?? []).some((e) => e.category === 'financial'))
    .map((c) => c.id),
)

test('the financial capabilities are derived from the effects, and there are some', () => {
  expect([...financial].toSorted()).toEqual([
    'hosting.addOn.add',
    'hosting.bundle.subscribe',
    'hosting.plan.subscribe',
  ])
})

test('every financial effect declares its amount, so a summary never says "amount unknown"', () => {
  const effects = manifest.capabilities.flatMap((c) =>
    (c.effects ?? []).filter((e) => e.category === 'financial').map((e) => ({ id: c.id, e })),
  )
  // two per priced capability: the first month, and the renewal
  expect(effects).toHaveLength(2 * financial.size)
  for (const { id, e } of effects) {
    const amount = (e as { amount?: { value: unknown; currency: string; per?: string } }).amount
    expect({ id, amount }).toEqual({
      id,
      amount: {
        value: 'target.priceUsd',
        currency: 'USD',
        ...(e.reversibility === 'compensable' && { per: 'month' }),
      },
    })
  }
})

test("every financial offer's amount is visible in each policy's view and in inspect", async () => {
  const sid = 's_priced'
  const { id } = store.account(sid).project
  const principal = principalFor(sid)
  let checked = 0
  for (const policy of builtInPolicies.map((p) => p.id)) {
    const projection = await runtime.project({
      principal,
      policy,
      start: { type: 'hosting.project', key: id },
    })
    // every offer the projection holds, and what the policy's view and any of its expansions show of them
    for (const offer of projection.offers.filter((o) => financial.has(o.capability))) {
      // the offer's id rides along, so a failure names the offer
      const summary = `${offer.id}: ${offer.requirements.confirmation?.summary}`
      expect(offer.requirements.confirmation?.summary).toBeDefined()
      expect(summary).not.toContain('unknown')
      // the target's price, as its resolver loads it, is in the summary the agent approves
      const target = await resolvers[offer.target!.type]!.load(offer.target!.key, principal)
      expect(summary).toContain(`${target!.attributes.priceUsd} USD`)
      // inspect gives the same offer
      const details = await projection.inspect(offer.id)
      expect(`${offer.id}: ${details.offer.requirements.confirmation?.summary}`).toBe(summary)
      checked++
    }
    // and the view a policy shows carries the same summaries, never a weaker one
    for (const offer of projection.view().offers.filter((o) => financial.has(o.capability)))
      expect(offer.requirements.confirmation?.summary).not.toContain('unknown')
  }
  // three plans, one bundle and three add-ons, under each policy
  expect(checked).toBe(7 * builtInPolicies.length)
})

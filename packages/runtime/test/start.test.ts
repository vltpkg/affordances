import { expect, test } from 'vitest'
import { decodeStart, encodeStart } from '../src/start.ts'

// a start on the wire (RFC 0004 §2.2): the one codec every transport and the route share
test('a start round-trips: a resource as type:key, an id as it is, and nothing for none', () => {
  for (const start of [
    { type: 'hosting.project', key: 'proj_1' },
    // the key may hold the separator: only the first one splits
    { type: 'hosting.plan', key: 'a:b' },
    'hosting.plan.subscribe',
  ])
    expect(decodeStart(encodeStart(start))).toEqual(start)
  expect(encodeStart(undefined)).toBeUndefined()
  for (const value of [undefined, '', 7, { type: 'x' }]) expect(decodeStart(value)).toBeUndefined()
})

// the input fields an offer id fixes, where the manifest says they go
test('inputOf puts the target key at targetAt and each bound reference at its at, and nothing for a non-id', async () => {
  const { inputOf } = await import('../src/offer-id.ts')
  const plans = (await import('../../ir/fixtures/valid/plans.json', { with: { type: 'json' } }))
    .default
  const m = plans as never
  expect(inputOf(m, 'hosting.plan.subscribe@hosting.plan:pro?project=p1')).toEqual({
    planId: 'pro',
    projectId: 'p1',
  })
  expect(inputOf(m, 'hosting.plan.subscribe@hosting.plan:pro')).toEqual({ planId: 'pro' })
  // a capability that doesn't say where its target's key goes, an unknown one, and what isn't an id
  expect(inputOf(m, 'hosting.plan.cancel@hosting.plan:pro')).toEqual({})
  expect(inputOf(m, 'nothing.here@x:y')).toEqual({})
  expect(inputOf(m, 'not an id')).toEqual({})
})

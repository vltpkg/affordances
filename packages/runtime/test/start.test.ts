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

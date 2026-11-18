import { expect, test } from 'vitest'
import { statusOf } from '../src/index.ts'

// RFC 0004 §2.3's statuses (boundary review #12): one mapping, in the runtime, for every host

const refused = (code: string, extra = {}) => ({ status: 'refused' as const, code, ...extra })
const signedIn = { authenticated: true }
const anonymous = { authenticated: false }

test('unauthorized is 401 with a Bearer challenge for a caller who isn’t signed in, and 403 for one who is', () => {
  expect(statusOf(refused('unauthorized'), anonymous)).toEqual({
    status: 401,
    headers: { 'www-authenticate': 'Bearer' },
  })
  expect(statusOf(refused('unauthorized'), signedIn)).toEqual({ status: 403, headers: {} })
})

test('every other code, in HTTP’s meanings', () => {
  const statuses = Object.fromEntries(
    [
      'not_found',
      'invalid_input',
      'precondition',
      'stale',
      'confirmation_required',
      'rate_limited',
      'constructor',
    ].map((c) => [c, statusOf(refused(c), signedIn).status]),
  )
  expect(statuses).toEqual({
    not_found: 404,
    invalid_input: 422,
    precondition: 409,
    stale: 409,
    confirmation_required: 409,
    rate_limited: 429,
    // a code the mapping doesn't hold, even one named like Object's own keys, is a plain 400
    constructor: 400,
  })
  expect(statusOf({ status: 'succeeded' }, signedIn).status).toBe(200)
  expect(statusOf({ status: 'failed' }, signedIn).status).toBe(500)
})

test('rate_limited carries Retry-After when the refusal says when, in whole seconds', () => {
  expect(statusOf(refused('rate_limited', { retryAfterSeconds: 2.4 }), signedIn)).toEqual({
    status: 429,
    headers: { 'retry-after': '3' },
  })
  expect(statusOf(refused('rate_limited'), signedIn)).toEqual({ status: 429, headers: {} })
  // a time that isn't one is no header, never Retry-After: NaN
  for (const retryAfterSeconds of [Number.NaN, Number.POSITIVE_INFINITY])
    expect(statusOf(refused('rate_limited', { retryAfterSeconds }), signedIn).headers).toEqual({})
})

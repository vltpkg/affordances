import { expect, test } from 'vitest'
import { applyDefaults, renderConfirmation, type Effect } from '../src/index.ts'

// RFC 0001 §3.2 and §4 (intake, 2026-11-18): a summary lists every charge, each with its amount, never totalled; and an
// input's declared defaults make the effective input

const monthly: Effect = {
  category: 'financial',
  description: 'The plan, monthly',
  reversibility: 'compensable',
  compensatedBy: 'hosting.plan.cancel',
  amount: { value: 'target.priceUsd', currency: 'USD', per: 'month' },
}
const once: Effect = {
  category: 'financial',
  description: 'A setup fee',
  reversibility: 'irreversible',
  amount: { value: 5, currency: 'USD' },
}
const context = { target: { priceUsd: 20 }, input: {} }

test('each charge is listed in order, with its amount and terms, and never totalled', () => {
  expect(renderConfirmation('Subscribe.', [monthly, once], context)).toBe(
    'Subscribe. Charges: 20 USD a month, until undone; 5 USD now, not refunded',
  )
})

test('no financial effect, no charges clause; a state effect is never a charge', () => {
  expect(
    renderConfirmation(
      'Rename it',
      [{ category: 'state', description: 'Renames', change: 'update', resource: 'r' }],
      context,
    ),
  ).toBe('Rename it')
})

test('an amount that can’t be resolved says so, and a charge with no amount does too', () => {
  const missing = renderConfirmation('Buy', [monthly], { target: {}, input: {} })
  expect(missing).toBe('Buy. Charges: amount unknown, until undone')
  const undeclared = renderConfirmation(
    'Buy',
    [{ category: 'financial', description: 'A charge' }],
    context,
  )
  expect(undeclared).toBe('Buy. Charges: amount unknown')
})

test('applies: false drops the charge, true keeps it, and unknown lists it as one that may apply', () => {
  const kept: Effect = {
    ...once,
    applies: { some: { of: 'input.addOns', where: { eq: [{ path: 'item' }, { value: 'x' }] } } },
  }
  expect(renderConfirmation('Go', [kept], { input: { addOns: ['x'] } })).toBe(
    'Go. Charges: 5 USD now, not refunded',
  )
  expect(renderConfirmation('Go', [kept], { input: { addOns: [] } })).toBe('Go')
  expect(renderConfirmation('Go', [kept], { input: {} })).toBe(
    'Go. Charges: 5 USD now, not refunded (may apply)',
  )
})

test('the effective input applies declared defaults where a property is omitted, at any depth, as a copy', () => {
  const schema = {
    type: 'object',
    properties: {
      addOns: { type: 'array', default: ['support'] },
      plan: { type: 'string' },
      options: { type: 'object', properties: { region: { type: 'string', default: 'us' } } },
    },
  }
  const given = { plan: 'pro', options: {} }
  expect(applyDefaults(schema, given)).toEqual({
    plan: 'pro',
    addOns: ['support'],
    options: { region: 'us' },
  })
  // the input passed in is left as it was, and a given value is never replaced by a default
  expect(given).toEqual({ plan: 'pro', options: {} })
  expect(applyDefaults(schema, { addOns: [] })).toMatchObject({ addOns: [] })
  // no input: the defaults alone
  expect(applyDefaults(schema, undefined)).toEqual({ addOns: ['support'] })
  // a default is a copy, never shared
  const a = applyDefaults(schema, {}) as { addOns: string[] }
  a.addOns.push('x')
  expect((applyDefaults(schema, {}) as { addOns: string[] }).addOns).toEqual(['support'])
})

test('a charge’s amount can’t read the principal', async () => {
  const { validate } = await import('../src/index.ts')
  const { readFileSync } = await import('node:fs')
  const m = JSON.parse(
    readFileSync(new URL('../fixtures/valid/plans.json', import.meta.url), 'utf8'),
  )
  m.capabilities[1].effects[0].amount.value = 'principal.plan'
  expect(validate(m).issues.map((i) => i.code)).toContain('E_PATH')
})

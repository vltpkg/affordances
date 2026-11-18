import { expect, test } from 'vitest'
import { checkOrderBasis, claimFree, type OrderBasis } from '../src/index.ts'

// RFC 0002 §6.4's group basis (intake, 2026-11-18, for RFC 0003's S): a manifest-derived key, never free text, and a
// claim-free order within

test('S’s basis is valid and claim-free', () => {
  const s = { by: 'group', key: 'targetType', within: { by: 'canonical' } }
  expect(checkOrderBasis(s)).toEqual({ ok: true, basis: s })
  expect(claimFree(s as OrderBasis)).toBe(true)
})

test('the existing bases stay valid', () => {
  for (const b of [
    { by: 'canonical' },
    { by: 'relevance', method: 'basic' },
    { by: 'claim', kind: 'recommendation', source: 'hosting-lab' },
  ])
    expect(checkOrderBasis(b).ok).toBe(true)
})

test.for([
  ['free text as a key', { by: 'group', key: 'best value first', within: { by: 'canonical' } }],
  ['an unknown key', { by: 'group', key: 'price', within: { by: 'canonical' } }],
  [
    'a claim within a group',
    {
      by: 'group',
      key: 'targetType',
      within: { by: 'claim', kind: 'recommendation', source: 'hosting-lab' },
    },
  ],
  [
    'a claim two groups deep',
    {
      by: 'group',
      key: 'targetType',
      within: {
        by: 'group',
        key: 'targetType',
        within: { by: 'claim', kind: 'recommendation', source: 'x' },
      },
    },
  ],
  ['a group without within', { by: 'group', key: 'targetType' }],
  [
    'an extra field, which could carry framing',
    { by: 'group', key: 'targetType', within: { by: 'canonical' }, note: 'recommended' },
  ],
  ['an extra field on canonical', { by: 'canonical', label: 'best' }],
  ['an unknown by', { by: 'popularity' }],
  ['not an object', 'canonical'],
] as [string, unknown][])('%s is rejected', ([, basis]) => {
  expect(checkOrderBasis(basis).ok).toBe(false)
})

test('a claim basis isn’t claim-free, and neither is a group around one', () => {
  const claim: OrderBasis = { by: 'claim', kind: 'recommendation', source: 'hosting-lab' }
  expect(claimFree(claim)).toBe(false)
  expect(
    claimFree({ by: 'group', key: 'targetType', within: claim } as unknown as OrderBasis),
  ).toBe(false)
})

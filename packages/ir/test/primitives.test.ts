import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import {
  base64url,
  decodePointer,
  digest,
  digestOf,
  encodePointer,
  getPointer,
  localId,
  normalize,
  putPointer,
  resolvePath,
  type CapabilityManifest,
} from '../src/index.ts'

// the primitives ir exports so nothing keeps its own copy (simplify A): each as the rule it encodes
const plans = (): CapabilityManifest =>
  JSON.parse(readFileSync(new URL('../fixtures/valid/plans.json', import.meta.url), 'utf8'))

test('a pointer decodes to the tokens it was encoded from, whatever they hold', () => {
  const tokens = ['', 'a', 'a/b', '~', '~1', 'a~b/c', '0', 'é']
  for (const a of tokens)
    for (const b of tokens) expect(decodePointer(encodePointer([a, b]))).toEqual([a, b])
  expect(decodePointer('')).toEqual([])
})

test('get reads own keys only, and put makes the objects on the way', () => {
  const value: Record<string, unknown> = {}
  putPointer(value, '/a/b~1c', 1)
  expect(value).toEqual({ a: { 'b/c': 1 } })
  expect(getPointer(value, '/a/b~1c')).toBe(1)
  expect(getPointer({}, '/constructor')).toBeUndefined()
})

test('a manifest’s digest is its normalized form’s digestOf, and base64url has no padding', async () => {
  const m = plans()
  expect(await digest(m)).toBe(await digestOf(normalize(m)))
  expect(base64url(new Uint8Array([255, 254, 253, 0]))).toBe('__79AA')
})

test('localId: itself, this namespace’s, never another’s', () => {
  const m = plans()
  expect(localId(m, 'hosting.plan')).toBe('hosting.plan')
  expect(localId(m, `${m.namespace}#hosting.plan`)).toBe('hosting.plan')
  expect(localId(m, 'https://other.example/x#hosting.plan')).toBeUndefined()
})

test('resolvePath: missing, absent, absent holding null, and a value, own keys only', () => {
  const context = { target: { a: 1, n: null, o: {} } }
  expect(resolvePath('target.a', context)).toEqual({ kind: 'value', value: 1 })
  expect(resolvePath('target.n', context)).toEqual({ kind: 'absent', null: true })
  expect(resolvePath('target.o.x', context)).toEqual({ kind: 'absent' })
  expect(resolvePath('target.z', context)).toEqual({ kind: 'missing' })
  expect(resolvePath('target.constructor', context)).toEqual({ kind: 'missing' })
  expect(resolvePath('item', context, 5)).toEqual({ kind: 'value', value: 5 })
})

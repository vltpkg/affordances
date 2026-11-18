import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { resolveIdentity } from '../src/config.ts'
import { MODULE_CODES, validate } from '@affordances/ir'
import { CATALOG, fails, format, type DiagnosticCode } from '../src/diagnostics.ts'

test("the catalog's codes are exactly RFC 0005 §3's table, so the two can't drift", () => {
  const rfc = readFileSync(
    new URL('../../../rfcs/0005-nextjs-compilation.md', import.meta.url),
    'utf8',
  )
  const table = [...rfc.matchAll(/^\| `([WE]_[A-Z_]+)`/gm)].map((m) => m[1]).toSorted()
  expect(Object.keys(CATALOG).toSorted()).toEqual(table)
  // every code is named by its severity
  for (const [code, entry] of Object.entries(CATALOG))
    expect(code.startsWith(entry.severity === 'error' ? 'E_' : 'W_')).toBe(true)
})

test('errors always fail a build; a strict warning fails only in strict mode; other warnings never do', () => {
  expect(fails('E_CAPABILITY_IMPORT')).toBe(true)
  for (const code of ['W_NO_ID', 'W_INPUT_OPAQUE', 'W_INPUT_LOSSY'] as DiagnosticCode[]) {
    expect(fails(code)).toBe(false)
    expect(fails(code, true)).toBe(true)
  }
  expect(fails('W_EFFECTS_UNKNOWN', true)).toBe(false)
})

test('a diagnostic reads as where, the code, what it means and how to fix it', () => {
  expect(
    format({ code: 'W_NO_ID', file: 'app/cart/actions.ts', line: 9, subject: 'updateQuantity' }),
  ).toBe(
    `app/cart/actions.ts:9 warning W_NO_ID (updateQuantity): ${CATALOG.W_NO_ID.means}. Fix: ${CATALOG.W_NO_ID.fix}.`,
  )
  expect(format({ code: 'W_NO_ID', file: 'a.ts' }, true)).toMatch(/^a\.ts error W_NO_ID: /)
})

test('the identity: a namespace URI as written, never inferred, an id prefix from the name, and an owner, all checked', () => {
  expect(
    resolveIdentity({
      name: 'Acme Store',
      namespace: 'https://acme.example/capabilities',
      owner: { id: 'acme', name: 'Acme' },
    }),
  ).toEqual({
    namespace: 'https://acme.example/capabilities',
    idPrefix: 'acmeStore',
    owner: { id: 'acme', name: 'Acme' },
    strict: false,
  })
  // a name gives the id prefix, never the namespace: the namespace is the app's identity (RFC 0005 §1)
  expect(resolveIdentity({ name: 'Acme Store', strict: true })).toEqual({
    idPrefix: 'acmeStore',
    strict: true,
  })
  expect(resolveIdentity({})).toEqual({ strict: false })
  // the prefix follows codegen's rule for id words (M5 boundary review, #16): a leading digit gets an 'r', and accents
  // are dropped first
  expect(resolveIdentity({ name: '42' }).idPrefix).toBe('r42')
  expect(resolveIdentity({ name: 'Café Shop' }).idPrefix).toBe('cafeShop')
  expect(resolveIdentity({ name: '  ' })).toEqual({ strict: false })
  // RFC 0001's namespace: an absolute URI with no fragment; an identifier isn't one
  expect(resolveIdentity({ namespace: 'urn:example:acme' }).namespace).toBe('urn:example:acme')
  for (const namespace of [
    'acme',
    'Acme Store',
    'https://acme.example/capabilities#x',
    '/capabilities',
  ])
    expect(() => resolveIdentity({ namespace })).toThrow(/isn't an absolute URI/)
  expect(() => resolveIdentity({ owner: { id: 'Acme', name: 'Acme' } })).toThrow(/owner\.id/)
  expect(() => resolveIdentity({ owner: { id: 'acme', name: ' ' } })).toThrow(
    /owner\.name is empty/,
  )
})

test('a diagnostic can say what to do in this place, after the general fix', () => {
  expect(format({ code: 'W_NO_NAMESPACE', file: 'next.config.ts', detail: 'paste this' })).toBe(
    `next.config.ts warning W_NO_NAMESPACE: ${CATALOG.W_NO_NAMESPACE.means}. Fix: ${CATALOG.W_NO_NAMESPACE.fix}. Here: paste this.`,
  )
})

// M5 boundary review, #10: the catalog and the IR's codes had drifted (W_AMOUNT_MISSING against W_NO_AMOUNT)
test('every code the authoring merge reports is in the catalog, so the two lists cannot drift again', () => {
  for (const code of MODULE_CODES) expect(Object.keys(CATALOG)).toContain(code)
})

test("the financial effect's missing amount has one name, RFC 0001's, in the IR and the catalog", () => {
  const charge = {
    schemaVersion: '0.1',
    namespace: 'https://acme.example/capabilities',
    provenance: { source: 'acme', basis: 'declared' },
    sources: [{ id: 'acme', role: 'owner', name: 'Acme' }],
    resources: [],
    capabilities: [
      {
        id: 'acme.pay',
        kind: 'action',
        description: 'Pay',
        authorization: { principal: 'authenticated' },
        confirmation: { summary: 'Pay' },
        effects: [{ category: 'financial', description: 'A charge' }],
      },
    ],
  }
  const codes = validate(charge).issues.map((i) => i.code)
  expect(codes).toContain('W_NO_AMOUNT')
  expect(CATALOG).toHaveProperty('W_NO_AMOUNT')
  expect(CATALOG).not.toHaveProperty('W_AMOUNT_MISSING')
})

test('a code the catalog doesn’t hold, relayed from the IR, is formatted from its own message and never throws', () => {
  const line = format({
    code: 'E_PATH',
    file: 'app/capabilities.ts',
    subject: '/capabilities/0',
    message: 'target.nope is not declared',
  })
  expect(line).toBe(
    'app/capabilities.ts error E_PATH (/capabilities/0): target.nope is not declared.',
  )
  expect(fails('E_PATH')).toBe(true)
  expect(fails('W_SOMETHING_NEW', true)).toBe(false)
  // an inherited key isn't a catalog entry
  expect(fails('E_toString' as never)).toBe(true)
  expect(format({ code: 'W_constructor' as never, file: 'a.ts', message: 'm' })).toBe(
    'a.ts warning W_constructor: m.',
  )
})

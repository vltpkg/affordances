import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { resolveIdentity } from '../src/config.ts'
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

test("the identity: a written namespace, or one inferred from the site's name, and an owner, all checked", () => {
  expect(resolveIdentity({ namespace: 'acme', owner: { id: 'acme', name: 'Acme' } })).toEqual({
    namespace: 'acme',
    namespaceFrom: 'config',
    owner: { id: 'acme', name: 'Acme' },
    strict: false,
  })
  // inferred from the name, and said to be
  expect(resolveIdentity({ name: 'Acme Store', strict: true })).toEqual({
    namespace: 'acmeStore',
    namespaceFrom: 'name',
    strict: true,
  })
  // nothing to go on
  expect(resolveIdentity({})).toBeUndefined()
  expect(resolveIdentity({ name: '42' })).toBeUndefined()
  // a written namespace and an owner id must be identifiers; an owner needs a name
  expect(() => resolveIdentity({ namespace: 'Acme Store' })).toThrow(/isn't an identifier/)
  expect(() => resolveIdentity({ owner: { id: 'Acme', name: 'Acme' } })).toThrow(/owner\.id/)
  expect(() => resolveIdentity({ owner: { id: 'acme', name: ' ' } })).toThrow(
    /owner\.name is empty/,
  )
})

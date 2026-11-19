import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { canonicalJson } from '../src/canonical.ts'
import { canonicalize, digest } from '../src/digest.ts'
import type { CapabilityManifest } from '../src/schema.ts'

const fixture = (file: string): CapabilityManifest =>
  JSON.parse(readFileSync(new URL(`../fixtures/valid/${file}`, import.meta.url), 'utf8'))
const files = readdirSync(new URL('../fixtures/valid', import.meta.url))
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

describe('the digest', () => {
  test('is the one RFC 0001 §11 states for its example', async () => {
    const rfc = readFileSync(
      new URL('../../../rfcs/0001-semantic-capability-ir.md', import.meta.url),
      'utf8',
    )
    const stated = rfc.match(/its digest is `(sha256-[A-Za-z0-9_-]+)`/)?.[1]
    expect(stated).toBeDefined()
    expect(await digest(fixture('rfc-0001-example.json'))).toBe(stated)
  })

  test.each(files)('of %s agrees with an independent SHA-256', async (file) => {
    const m = fixture(file)
    const expected = `sha256-${createHash('sha256').update(canonicalize(m)).digest('base64url')}`
    expect(await digest(m)).toBe(expected)
  })

  test('has the stated form: sha256-, then 43 base64url characters, no padding', async () => {
    for (const file of files)
      expect(await digest(fixture(file))).toMatch(/^sha256-[A-Za-z0-9_-]{43}$/)
  })
})

describe('the canonical bytes', () => {
  test.each(files)('of %s round-trip: parsing and re-serializing gives the same bytes', (file) => {
    const bytes = text(canonicalize(fixture(file)))
    expect(canonicalJson(JSON.parse(bytes))).toBe(bytes)
    expect(text(canonicalize(JSON.parse(bytes)))).toBe(bytes)
  })

  test('have no whitespace between tokens', () => {
    const bytes = text(canonicalize(fixture('plans.json')))
    // outside strings: strip them, then look
    expect(bytes.replace(/"(?:[^"\\]|\\.)*"/g, '""')).not.toMatch(/\s/)
  })

  test("aren't Unicode-normalized: NFC and NFD of one title differ", async () => {
    const m = fixture('minimal.json')
    const nfc = await digest({ ...m, title: 'Caf\u00e9' })
    const nfd = await digest({ ...m, title: 'Cafe\u0301' })
    expect(nfc).not.toBe(nfd)
  })
})

// RFC 8785's own examples
describe('RFC 8785', () => {
  test('sorts members by UTF-16 code units (§3.2.3)', () => {
    const input = {
      '\u20ac': 'Euro Sign',
      '\r': 'Carriage Return',
      '\ufb33': 'Hebrew Letter Dalet With Dagesh',
      '1': 'One',
      '\ud83d\ude00': 'Emoji: Grinning Face',
      '\u0080': 'Control',
      '\u00f6': 'Latin Small Letter O With Diaeresis',
    }
    expect(canonicalJson(input).match(/"([^"]*)":/g)).toEqual([
      '"\\r":',
      '"1":',
      '"\u0080":',
      '"\u00f6":',
      '"\u20ac":',
      '"\ud83d\ude00":',
      '"\ufb33":',
    ])
  })

  test('writes numbers as ECMAScript does (Appendix B)', () => {
    const cases: [number, string][] = [
      [0, '0'],
      [-0, '0'],
      [1e21, '1e+21'],
      [1e-7, '1e-7'],
      [0.000001, '0.000001'],
      [4.5, '4.5'],
      [333333333.3333333, '333333333.3333333'],
      [-1.5e-300, '-1.5e-300'],
    ]
    expect(cases.map(([n]) => canonicalJson(n))).toEqual(cases.map(([, s]) => s))
  })

  test('escapes minimally, with lowercase hex', () => {
    expect(canonicalJson('\u000f\u007f"\\/\n')).toBe('"\\u000f\u007f\\"\\\\/\\n"')
  })

  test('rejects what I-JSON forbids', () => {
    expect(() => canonicalJson(Number.NaN)).toThrow("isn't I-JSON")
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow("isn't I-JSON")
  })
})

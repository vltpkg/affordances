import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { checkModule, findModules } from '../src/modules.ts'

// RFC 0005 §1's capability modules: found by the walk codegen does, and checked statically before anything is
// evaluated. A module may import the authoring API, a schema library and other capability modules; it may not reach the
// environment, the network or the clock; and it may not use syntax Node can't erase

let root: string
const write = (rel: string, text: string) => {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
  writeFileSync(path.join(root, rel), text)
}
const codes = (rel: string, text: string) => {
  write(rel, text)
  return checkModule(root, path.join(root, rel)).map((d) => [d.code, d.subject])
}

beforeAll(() => {
  root = mkdtempSync(path.join(import.meta.dirname, '.modules-'))
  write(
    'tsconfig.json',
    '{\n  // Next apps have comments here\n  "compilerOptions": { "paths": { "@/*": ["./app/*"] } },\n}\n',
  )
  write('app/capabilities.ts', 'export {}\n')
  write('app/products/capabilities.ts', 'export {}\n')
  write('app/products/schemas.ts', 'export const S = 1\n')
  write('app/_private/capabilities.ts', 'export {}\n')
  write('app/cart/capabilities.tsx', 'export {}\n')
  write('app/cart/capabilities.js', 'export {}\n')
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

test('a capability module is capabilities.ts, anywhere but _private, and other extensions are refused', () => {
  const { modules, diagnostics } = findModules(root)
  expect(modules.map((m) => path.relative(root, m))).toEqual([
    'app/capabilities.ts',
    'app/products/capabilities.ts',
  ])
  expect(diagnostics.map((d) => [d.code, d.file])).toEqual([
    ['E_CAPABILITY_SYNTAX', 'app/cart/capabilities.tsx'],
    ['E_CAPABILITY_SYNTAX', 'app/cart/capabilities.js'],
  ])
})

test('the authoring API, schema libraries, other capability modules and type-only imports are allowed', () => {
  expect(
    codes(
      'app/ok/capabilities.ts',
      [
        "import { defineCapability } from '@affordances/ir/author'",
        "import { defineResource } from '@affordances/next/author'",
        "import { z } from 'zod'",
        "import * as v from 'valibot'",
        "import { plan } from '../products/capabilities'",
        "import { other } from '@/products/capabilities'",
        "import type { Order } from '../../lib/db'",
        "import { type Row } from '../../lib/db'",
        "export { plan } from '../products/capabilities'",
        'export const x = z.string()',
      ].join('\n'),
    ),
  ).toEqual([])
})

test('application code and other packages are E_CAPABILITY_IMPORT, naming the import', () => {
  expect(
    codes(
      'app/bad/capabilities.ts',
      [
        "import { S } from '../products/schemas'",
        "import { db } from '@/products/schemas'",
        "import lodash from 'lodash'",
        "export { S as T } from '../products/schemas'",
      ].join('\n'),
    ),
  ).toEqual([
    ['E_CAPABILITY_IMPORT', '../products/schemas'],
    ['E_CAPABILITY_IMPORT', '@/products/schemas'],
    ['E_CAPABILITY_IMPORT', 'lodash'],
    ['E_CAPABILITY_IMPORT', '../products/schemas'],
  ])
})

test('the environment, the network and the clock are E_CAPABILITY_AMBIENT; a local binding of the same name isn’t', () => {
  expect(
    codes(
      'app/ambient/capabilities.ts',
      [
        'export const a = process.env.X',
        'export const b = Date.now()',
        'export const c = Math.random()',
        'export const d = () => fetch("https://x.example")',
        'export const e = () => setTimeout(() => {}, 1)',
        "export const f = () => import('./x')",
        "export const g = () => require('x')",
        'export const h = crypto.randomUUID()',
        'export const i = Math.max(1, 2)',
      ].join('\n'),
    )
      .map(([code, subject]) => `${code} ${subject}`)
      .toSorted(),
  ).toEqual(
    ['process', 'Date', 'fetch', 'setTimeout', 'require', 'crypto', 'Math.random', 'import()']
      .map((s) => `E_CAPABILITY_AMBIENT ${s}`)
      .toSorted(),
  )

  // a module's own binding named like an ambient value is its own
  expect(
    codes(
      'app/local/capabilities.ts',
      'const Date = { now: () => 1 }\nexport const t = Date.now()\n',
    ),
  ).toEqual([])
})

test('syntax Node can’t erase is E_CAPABILITY_SYNTAX, with its location', () => {
  write(
    'app/syntax/capabilities.ts',
    [
      "enum Status { Open = 'open' }",
      'namespace N { export const x = 1 }',
      "import fs = require('node:fs')",
      'class C { constructor(private readonly x: number) {} }',
    ].join('\n'),
  )
  const found = checkModule(root, path.join(root, 'app/syntax/capabilities.ts')).filter(
    (d) => d.code === 'E_CAPABILITY_SYNTAX',
  )
  expect(found.map((d) => [d.subject, d.line])).toEqual([
    ['an enum', 1],
    ['a namespace', 2],
    ['import =', 3],
    ['a parameter property', 4],
  ])
  expect(found[0]!.detail).toMatch(/const object and z\.enum/)
})

test('a module that doesn’t parse is one diagnostic, never a throw', () => {
  expect(codes('app/broken/capabilities.ts', 'export const = (\n')).toEqual([
    ['E_CAPABILITY_SYNTAX', 'parse'],
  ])
})

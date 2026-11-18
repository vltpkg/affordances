import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'
import {
  aliasesOf,
  checkModule,
  findModules,
  jsonc,
  readAliases,
  resolveImport,
} from '../src/modules.ts'

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

  // the global object's aliases, and what's stable on one machine but not across them (review of 299c02d4)
  expect(
    codes(
      'app/aliases/capabilities.ts',
      [
        'export const a = globalThis.process.platform',
        'export const b = global.crypto',
        'export const c = () => self.fetch',
        'export const d = performance.now()',
        'export const e = Intl.DateTimeFormat().resolvedOptions().timeZone',
        'export const f = navigator.language',
        'export const g = Number.MAX_SAFE_INTEGER + JSON.stringify([1]).length + Math.max(1, 2)',
      ].join('\n'),
    )
      .map(([code, subject]) => `${code} ${subject}`)
      .toSorted(),
  ).toEqual(
    ['globalThis', 'global', 'self', 'performance', 'Intl', 'navigator']
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

// a tsconfig shaped like hosting-lab's, with what broke the old stripper, and the paths given
const tsconfigWith = (extra: string) => `{
  // a comment, and /* a block one */
  "compilerOptions": { ${extra} "plugins": [{ "name": "next" }], "x": "https://example.com/a,]" },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts",],
}`

// hosting-lab's real tsconfig broke a regex comment stripper: "@/*" in paths and "**/*.ts" in include read as one
// /* … */ comment, so the parse failed and every alias silently went (2026-11-18)
test('tsconfig paths survive globs, URLs, comments and trailing commas in strings, and come through extends', () => {
  const dir = mkdtempSync(path.join(import.meta.dirname, '.aliases-'))
  try {
    mkdirSync(path.join(dir, 'app', 'src', 'app'), { recursive: true })
    writeFileSync(path.join(dir, 'app', 'src', 'app', 'capabilities.ts'), 'export {}\n')
    writeFileSync(
      path.join(dir, 'app', 'tsconfig.json'),
      tsconfigWith('"paths": { "@/*": ["./src/*"] },'),
    )
    const app = path.join(dir, 'app')
    const target = path.join(app, 'src', 'app', 'capabilities.ts')
    expect(aliasesOf(app)).toEqual([{ prefix: '@/', targets: [path.join(app, 'src')] }])
    expect(
      resolveImport(app, path.join(app, 'src', 'app', 'actions.ts'), '@/app/capabilities'),
    ).toBe(target)
    // the same paths, set by a config the app's extends, resolve against that config's directory
    writeFileSync(
      path.join(dir, 'tsconfig.base.json'),
      tsconfigWith('"paths": { "@/*": ["./app/src/*"] },'),
    )
    writeFileSync(
      path.join(app, 'tsconfig.json'),
      '{ "extends": "../tsconfig.base.json", "include": ["**/*.ts"] }',
    )
    expect(
      resolveImport(app, path.join(app, 'src', 'app', 'actions.ts'), '@/app/capabilities'),
    ).toBe(target)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// jsonc against TypeScript's own JSONC rules: every placement of a comment and a trailing comma it accepts, and strings
// that look like either (review of 65d47ddb: a trailing comma followed by a comment threw)
test('jsonc reads every comment and trailing-comma placement TypeScript accepts, and leaves strings alone', () => {
  const corpus: [string, unknown][] = [
    ['{ "a": 1, // aliases\n}', { a: 1 }],
    ['[1, /* last */ ]', [1]],
    ['[1, /* a */ /* b */\n// c\n]', [1]],
    ['{ "a": [1,], }', { a: [1] }],
    ['{ "a": 1 /* x */, "b": 2 }', { a: 1, b: 2 }],
    ['// first\n{ "a": 1 }\n// last', { a: 1 }],
    ['{ "a": 1 } // no newline at the end', { a: 1 }],
    ['{ "a": "**/*.ts", "b": "./src/*" }', { a: '**/*.ts', b: './src/*' }],
    [
      '{ "a": "https://example.com/x", "b": "a,]" , "c": "a,}" }',
      { a: 'https://example.com/x', b: 'a,]', c: 'a,}' },
    ],
    [
      '{ "a": "quote \\" // not a comment", "b": "back\\\\" }',
      { a: 'quote " // not a comment', b: 'back\\' },
    ],
    ['{ "a"/* between */: 1 }', { a: 1 }],
  ]
  for (const [text, value] of corpus) expect({ text, value: jsonc(text) }).toEqual({ text, value })
  // an unterminated block comment is unreadable. A lone comma ('[,]') reads as a trailing one, so as empty: laxer than
  // tsc, and harmless for reading a config
  expect(() => jsonc('{ "a": 1 /* open')).toThrow('an unterminated /* comment')
})

test('an unreadable tsconfig, or a missing extended one, is named; a jsconfig is read when there’s no tsconfig', () => {
  const dir = mkdtempSync(path.join(import.meta.dirname, '.aliases-'))
  try {
    writeFileSync(
      path.join(dir, 'tsconfig.json'),
      '{ "compilerOptions": { "paths": { "@/*": ["./*"] } ',
    )
    expect(readAliases(dir)).toMatchObject({ aliases: [], unreadable: { file: 'tsconfig.json' } })
    writeFileSync(path.join(dir, 'tsconfig.json'), '{ "extends": "./missing" }')
    expect(readAliases(dir)).toMatchObject({ aliases: [], unreadable: { file: 'missing.json' } })
    rmSync(path.join(dir, 'tsconfig.json'))
    writeFileSync(
      path.join(dir, 'jsconfig.json'),
      '{ "compilerOptions": { "paths": { "@/*": ["./src/*"] }, }, }',
    )
    expect(readAliases(dir)).toEqual({
      aliases: [{ prefix: '@/', targets: [path.join(dir, 'src')] }],
    })
    // baseUrl from the app's config, paths from the one it extends: paths resolve against the baseUrl, as in tsc
    rmSync(path.join(dir, 'jsconfig.json'))
    mkdirSync(path.join(dir, 'base'))
    writeFileSync(
      path.join(dir, 'base', 'tsconfig.json'),
      '{ "compilerOptions": { "paths": { "~/*": ["lib/*"] } } }',
    )
    writeFileSync(
      path.join(dir, 'tsconfig.json'),
      '{ "extends": "./base/tsconfig.json", "compilerOptions": { "baseUrl": "./app" } }',
    )
    expect(aliasesOf(dir)).toEqual([{ prefix: '~/', targets: [path.join(dir, 'app', 'lib')] }])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

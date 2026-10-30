import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { generate, render, scan } from '../src/codegen.ts'

const fixture = path.join(import.meta.dirname, 'fixture')

test('scans actions and state, skipping route groups and private folders', () => {
  expect(scan(fixture)).toEqual([
    { route: '/cart', state: 'app/(shop)/cart/state' },
    {
      route: '/products/[slug]',
      state: 'app/products/[slug]/state',
      actions: {
        file: 'app/products/[slug]/actions',
        exports: [
          { local: 'addToCart', name: 'addToCart' },
          { local: 'buyNow', name: 'buyNow' },
        ],
      },
    },
  ])
})

test('renders a manifest', () => {
  expect(render(scan(fixture), { name: 'Fixture' })).toMatchSnapshot()
})

const project = (files: Record<string, string>) => {
  const root = mkdtempSync(path.join(tmpdir(), 'affordances-'))
  for (const [file, source] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    writeFileSync(path.join(root, file), source)
  }
  return root
}

test.each([
  [
    'a non-literal name',
    `'use server'\nexport const a = defineAction({ name: n })`,
    'needs a string literal `name`',
  ],
  [
    'duplicate names',
    `'use server'\nexport const a = defineAction({ name: 'x' })\nexport const b = defineAction({ name: 'x' })`,
    'two actions are named x on /',
  ],
  [
    'a missing directive',
    `export const a = defineAction({ name: 'x' })`,
    "must start with 'use server'",
  ],
])('fails on %s', (_, source, message) => {
  const root = project({ 'app/actions.ts': source })
  expect(() => scan(root)).toThrow(message)
  rmSync(root, { recursive: true })
})

test('fails on a state file without a default export', () => {
  const root = project({ 'src/app/x/state.ts': 'export const s = 1' })
  expect(() => scan(root)).toThrow('must `export default defineState')
  rmSync(root, { recursive: true })
})

test('generate writes .affordances/manifest.ts', () => {
  generate(fixture, { name: 'Fixture' })
  expect(readFileSync(path.join(fixture, '.affordances/manifest.ts'), 'utf8')).toBe(
    render(scan(fixture), { name: 'Fixture' }),
  )
})

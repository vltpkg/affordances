import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { scan } from '../src/codegen.ts'
import { compileSync } from '../src/compile.ts'

// M7b, the v0 adapter, v0 to IR: v0's identity is (route pattern, name) (repo audit §6), and the compiled bindings
// must recover it exactly for every action that has a capability, by its own id or by binding one. A generated sweep
// over route shapes (static, dynamic, catch-all, optional catch-all, route groups, parallel slots) and actions (an id,
// a bound capability, or neither, which compiles to no capability)

let root: string
let n = 0
beforeAll(() => {
  root = mkdtempSync(path.join(import.meta.dirname, '.v0-adapter-'))
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

const ACTIONS =
  "'use server'\nimport { defineAction } from '@affordances/next'\nimport { z } from 'zod'\n"
const options = {
  namespace: 'https://shop.example/capabilities',
  owner: { id: 'shop', name: 'Shop' },
}

// a seeded generator, so a failure names its case and reruns the same (mulberry32)
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let x = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296
}
// a route's folders, with what Next leaves out of the url: groups and parallel slots. A catch-all ends its route
const FOLDERS = [
  ['products', 'cart', 'plans', 'account', 'docs'],
  ['[slug]', '[id]'],
  ['[...rest]'],
  ['[[...opt]]'],
  ['(shop)', '(marketing)'],
  ['@modal'],
]
type Kind = 'id' | 'bound' | 'none'
type Route = { folders: string[]; actions: { name: string; kind: Kind }[] }
const NAMES = ['add', 'remove', 'subscribe', 'listAll', 'go']
const appOf = (seed: number): Route[] => {
  const next = rng(seed)
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)]!
  const routes = new Map<string, Route>()
  const count = 1 + Math.floor(next() * 4)
  for (let r = 0; r < count; r++) {
    const folders: string[] = []
    const depth = Math.floor(next() * 5)
    for (let d = 0; d < depth; d++) {
      const f = pick(pick(FOLDERS))
      folders.push(f)
      if (f.startsWith('[...') || f.startsWith('[[...')) break
    }
    const names = NAMES.filter(() => next() < 0.5)
    const actions = (names.length ? names : [pick(NAMES)]).map((name) => ({
      name,
      kind: pick<Kind>(['id', 'bound', 'none']),
    }))
    routes.set(folders.join('/'), { folders, actions })
  }
  return [...routes.values()]
}
const SEEDS = Array.from({ length: 25 }, (_, i) => 7702 + i)

test('the seeds cover every folder form and every action kind, so the sweep below isn’t vacuous', () => {
  const apps = SEEDS.map(appOf)
  const folders = new Set(apps.flatMap((a) => a.flatMap((r) => r.folders)))
  for (const forms of FOLDERS) expect(forms.some((f) => folders.has(f))).toBe(true)
  const kinds = new Set(apps.flatMap((a) => a.flatMap((r) => r.actions.map((x) => x.kind))))
  expect([...kinds].toSorted()).toEqual(['bound', 'id', 'none'])
  // and a folder the url leaves out, a route group or a parallel slot
  expect(
    apps.some((a) => a.some((r) => r.folders.some((f) => f.startsWith('(') || f.startsWith('@')))),
  ).toBe(true)
})

test('every action with a capability compiles to a binding at exactly its v0 (route pattern, name)', async () => {
  for (const seed of SEEDS) {
    {
      const routes = appOf(seed)
      const dir = path.join(root, `app${n++}`)
      const write = (rel: string, text: string) => {
        mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
        writeFileSync(path.join(dir, rel), text)
      }
      // a global capability per bound action, each with its own id
      const caps: string[] = []
      routes.forEach((r, i) => {
        const body = r.actions
          .map((a, j) => {
            if (a.kind === 'id')
              return `export const ${a.name} = defineAction({ name: '${a.name}', id: 'shop.r${i}.a${j}', description: 'x', expose: 'public', run: async () => {} })`
            if (a.kind === 'bound') {
              caps.push(
                `export const c${i}x${j} = defineCapability({ id: 'shop.bound.r${i}a${j}', kind: 'action', description: 'x' })`,
              )
              return `import { c${i}x${j} } from '@/app/capabilities'\nexport const ${a.name} = defineAction({ capability: c${i}x${j}, name: '${a.name}', run: async () => {} })`
            }
            return `export const ${a.name} = defineAction({ name: '${a.name}', description: 'x', run: async () => {} })`
          })
          .join('\n')
        write(path.join('app', ...r.folders, 'actions.ts'), `${ACTIONS}${body}\n`)
      })
      write(
        'app/capabilities.ts',
        `import { defineCapability } from '@affordances/ir'\n${caps.join('\n')}\nexport {}\n`,
      )
      write('tsconfig.json', '{ "compilerOptions": { "paths": { "@/*": ["./*"] } } }')

      // v0's own view of the app: each route pattern and its action names, as v0's manifest.ts is generated
      const v0 = scan(dir).flatMap((e) =>
        (e.actions?.exports ?? []).map((x) => ({ route: e.route, name: x.name, x })),
      )
      const expected = v0
        .filter(({ x }) => x.id || x.bound)
        .map(({ route, name }) => `${route} ${name}`)
        .toSorted()

      const r = compileSync(dir, options)
      expect({ seed, errors: r.diagnostics.filter((d) => d.code.startsWith('E_')) }).toEqual({
        seed,
        errors: [],
      })
      const got = r.bindings.map((b) => `${b.address.route} ${b.address.action}`).toSorted()
      expect({ seed, routes: routes.map((x) => x.folders.join('/')), got }).toEqual({
        seed,
        routes: routes.map((x) => x.folders.join('/')),
        got: expected,
      })
      // and the manifest's own bindings say the same
      const manifest = JSON.parse(r.canonical!) as {
        bindings?: { address: { route: string; action: string } }[]
      }
      expect(
        (manifest.bindings ?? []).map((b) => `${b.address.route} ${b.address.action}`).toSorted(),
      ).toEqual(expected)
    }
  }
}, 600_000)

// the same, on the repo's real bound app: hosting-lab binds its actions to capability modules. apps/example has no id
// and no capability, so it compiles no binding: it's the v0-only app, checked byte for byte against main instead
test.each(['hosting-lab'])(
  'apps/%s: its bindings are exactly its v0 (route pattern, name)',
  (app) => {
    const dir = path.join(import.meta.dirname, '..', '..', '..', 'apps', app)
    const expected = scan(dir)
      .flatMap((e) =>
        (e.actions?.exports ?? []).flatMap((x) =>
          x.id || x.bound ? [`${e.route} ${x.name}`] : [],
        ),
      )
      .toSorted()
    expect(expected.length).toBeGreaterThan(0)
    const r = compileSync(dir, options)
    expect(r.diagnostics.filter((d) => d.code.startsWith('E_'))).toEqual([])
    expect(r.bindings.map((b) => `${b.address.route} ${b.address.action}`).toSorted()).toEqual(
      expected,
    )
  },
  300_000,
)

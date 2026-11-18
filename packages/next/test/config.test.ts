import type { NextConfig } from 'next'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test, vi } from 'vitest'
import { INDEX_ENV, noNamespace, rewrites, toSource, withAffordances } from '../src/config.ts'

test('route patterns become header sources', () => {
  expect(toSource('/products/[slug]')).toBe('/products/:slug')
  expect(toSource('/docs/[...slug]')).toBe('/docs/:slug+')
  expect(toSource('/shop/[[...slug]]')).toBe('/shop/:slug*')
})

test('the page rewrite skips our handler and next internals', () => {
  const source = rewrites.find((r) => r.source.startsWith('/:path'))!.source
  const re = new RegExp(`^/${source.slice('/:path'.length)}$`)
  expect(re.test('/products/tee')).toBe(true)
  expect(re.test('/apis')).toBe(true)
  expect(re.test('/api/affordances/graph/products')).toBe(false)
  expect(re.test('/api/other')).toBe(false)
  expect(re.test('/_next/static/x.js')).toBe(false)
})

test('plugins wrap the config in order, after the graph', async () => {
  const order: string[] = []
  const plugin =
    (name: string) =>
    <C extends object>(config: C): C => {
      order.push(name)
      return { ...config, [name]: true }
    }
  const config = withAffordances({} as NextConfig, {
    root: path.join(import.meta.dirname, 'fixture'),
    plugins: [plugin('a'), plugin('b')],
  })
  expect(order).toEqual(['a', 'b'])
  expect(config).toMatchObject({ a: true, b: true })
  expect(config.rewrites).toBeTypeOf('function')
})

test('withAffordances prepends its rewrites and keeps the user config', async () => {
  const config = withAffordances(
    {
      reactCompiler: true,
      rewrites: async () => [{ source: '/old', destination: '/new' }],
      headers: async () => [{ source: '/x', headers: [{ key: 'a', value: 'b' }] }],
    },
    { root: path.join(import.meta.dirname, 'fixture') },
  )
  expect(config.reactCompiler).toBe(true)
  const r = (await config.rewrites!()) as unknown as {
    beforeFiles: unknown[]
    afterFiles: unknown[]
  }
  expect(r.beforeFiles).toEqual(rewrites)
  expect(r.afterFiles).toEqual([{ source: '/old', destination: '/new' }])
  const h = await config.headers!()
  expect(h.map((x) => x.source)).toEqual(['/cart', '/products/:slug', '/x'])
  expect(h[0]!.headers).toContainEqual({
    key: 'Link',
    value: '<?affordances=1>; rel="affordances"',
  })
})

test("the app's env says where its index is, for plugins that read it, and the user's env survives", () => {
  const root = path.join(import.meta.dirname, 'fixture')
  const config = withAffordances({ env: { A: '1' } }, { root })
  expect(config.env).toEqual({ A: '1', [INDEX_ENV]: '/.well-known/affordances.json' })
})

test('the route handler finds the manifest through an alias, and user aliases survive', () => {
  const root = path.join(import.meta.dirname, 'fixture')
  const config = withAffordances(
    {
      turbopack: { resolveAlias: { lodash: 'lodash-es' } },
      webpack: (c: object, _context: unknown) => ({ ...c, seen: true }),
    },
    { root },
  )
  // turbopack wants it relative to the project; webpack takes the absolute path
  expect(config.turbopack!.resolveAlias).toEqual({
    lodash: 'lodash-es',
    '@affordances/next/manifest': `./${path.relative(process.cwd(), path.join(root, '.affordances/manifest.ts'))}`,
  })
  const webpack = config.webpack!({ resolve: { alias: {} } }, {}) as {
    seen: boolean
    resolve: { alias: Record<string, string> }
  }
  expect(webpack.seen).toBe(true)
  expect(webpack.resolve.alias['@affordances/next/manifest']).toBe(
    path.join(root, '.affordances/manifest.ts'),
  )
})

// RFC 0005 §1: with no namespace, nothing is inferred and no manifest is written. The build says which one line turns
// it on, pre-filled when the site's URL can be read statically, and never writes it in
const app = (files: Record<string, string>) => {
  const root = mkdtempSync(path.join(tmpdir(), 'affordances-namespace-'))
  for (const [file, text] of Object.entries({
    'app/page.tsx': 'export default () => null',
    ...files,
  })) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    writeFileSync(path.join(root, file), text)
  }
  return root
}

test("no namespace: the line to paste, suggested from the root layout's literal metadataBase, then package.json's homepage", () => {
  const layout = app({
    'next.config.ts': 'export default {}',
    'app/layout.tsx':
      "export const metadata = { metadataBase: new URL('https://acme.example/shop') }",
    'package.json': JSON.stringify({ homepage: 'https://github.com/acme/store' }),
  })
  expect(noNamespace(layout)).toEqual({
    code: 'W_NO_NAMESPACE',
    file: 'next.config.ts',
    detail:
      "add `namespace: 'https://acme.example/capabilities'` to withAffordances' options (suggested from app/layout.tsx's metadataBase, not applied)",
  })
  const homepage = app({ 'package.json': JSON.stringify({ homepage: 'https://acme.example' }) })
  expect(noNamespace(homepage).detail).toBe(
    "add `namespace: 'https://acme.example/capabilities'` to withAffordances' options (suggested from package.json's homepage, not applied)",
  )
  // a metadataBase that isn't a literal can't be read without running the app, so nothing is suggested
  const computed = app({
    'app/layout.tsx': 'export const metadata = { metadataBase: new URL(process.env.SITE!) }',
  })
  expect(noNamespace(computed)).toEqual({
    code: 'W_NO_NAMESPACE',
    file: 'next.config',
    detail: "add `namespace: 'https://<your-site>/capabilities'` to withAffordances' options",
  })
})

test('a build with no namespace breaks nothing, writes no manifest, and prints the line once', async () => {
  vi.resetModules()
  const { withAffordances: fresh } = await import('../src/config.ts')
  const root = app({
    'next.config.ts': 'export default {}',
    'package.json': JSON.stringify({ homepage: 'https://acme.example' }),
  })
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    const config = fresh({} as NextConfig, { root })
    fresh({}, { root })
    expect(config.rewrites).toBeTypeOf('function')
    expect(existsSync(path.join(root, '.affordances', 'manifest.json'))).toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![0]).toContain(
      'W_NO_NAMESPACE: No namespace is configured, so no capability manifest is written',
    )
    expect(warn.mock.calls[0]![0]).toContain(
      "Here: add `namespace: 'https://acme.example/capabilities'` to withAffordances' options (suggested from package.json's homepage, not applied).",
    )
    // suggested, never applied: the config on disk is untouched
    expect(readFileSync(path.join(root, 'next.config.ts'), 'utf8')).toBe('export default {}')
  } finally {
    warn.mockRestore()
  }
})

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createAffordances, createHandler } from '@affordances/core'
import { afterAll, describe, expect, test } from 'vitest'
import { z } from 'zod'
import { writeCompiled } from '../src/compile.ts'
import { API_PATH, MANIFEST_PATH } from '../src/constants.ts'
import { createRouteHandler } from '../src/route.ts'

// M7b2, RFC 0004 §2's discovery: the site index names version 1 only for a site with capabilities that publishes its
// manifest, and the manifest is served public and cacheable, under the catch-all as the index is. 'private' serves it
// to no one, and a v0-only app's index is unchanged under either setting

const { defineAction, defineState } = createAffordances<{ id: string }>({
  auth: (request) => {
    const id = request.headers.get('authorization')?.replace('Bearer ', '')
    return id ? { id } : null
  },
})
const page = defineState(() => ({ count: 1 }))
const bump = defineAction({
  name: 'bump',
  description: 'Bump it',
  input: z.object({}),
  expose: 'public',
  state: page,
  run: async () => 'bumped',
})
const manifest = { name: 'Site', routes: { '/': { state: page, actions: [bump] } } }
const compiled = { canonical: '{"schemaVersion":"0.1"}', digest: 'sha256-abc' }
const origin = 'https://site.test'
const request = (p: string, init: RequestInit = {}) => new Request(`${origin}${API_PATH}${p}`, init)
const index = async (handler: (r: Request) => Promise<Response>) =>
  (await handler(request('/.well-known/affordances.json'))).text()

const dirs: string[] = []
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })))

test('writeCompiled always writes capabilities.ts: the manifest when there is one, null when there isn’t', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'affordances-discovery-'))
  dirs.push(dir)
  const file = path.join(dir, '.affordances', 'capabilities.ts')
  writeCompiled(dir, { bindings: [], diagnostics: [], failed: false })
  expect(readFileSync(file, 'utf8')).toMatch(/export const capabilities = null\n$/)
  writeCompiled(dir, { ...compiled, bindings: [], diagnostics: [], failed: false })
  expect(readFileSync(file, 'utf8')).toContain(
    `export const capabilities = { canonical: ${JSON.stringify(compiled.canonical)}, digest: "sha256-abc" }`,
  )
})

describe('a v0-only app (no compiled manifest)', () => {
  test.each(['public', 'private'] as const)(
    'its site index is byte for byte v0’s, under %s',
    async (visibility) => {
      const v0 = createHandler({ manifest, basePath: API_PATH })
      const route = createRouteHandler({ manifest, compiled: null, visibility })
      expect(await index(route)).toBe(await index(v0))
      expect(await index(route)).not.toContain('capabilities')
      // and there's no manifest to serve
      expect((await route(request(MANIFEST_PATH))).status).toBe(404)
    },
  )
})

describe('an app with capabilities', () => {
  test('public: the index names the manifest and version 1’s base, and the manifest is served, cacheable', async () => {
    const route = createRouteHandler({ manifest, compiled, visibility: 'public' })
    expect(JSON.parse(await index(route)).capabilities).toEqual({
      manifest: MANIFEST_PATH,
      base: '/api/projection',
    })
    const got = await route(request(MANIFEST_PATH))
    expect([got.status, await got.text()]).toEqual([200, compiled.canonical])
    expect(
      Object.fromEntries(['etag', 'cache-control'].map((h) => [h, got.headers.get(h)])),
    ).toEqual({
      etag: '"sha256-abc"',
      'cache-control': 'public, max-age=300',
    })
    // a client that holds it gets a 304, and the bytes are the same whoever asks: no principal's data
    expect(
      (await route(request(MANIFEST_PATH, { headers: { 'if-none-match': '"sha256-abc"' } })))
        .status,
    ).toBe(304)
    const signedIn = await route(
      request(MANIFEST_PATH, { headers: { authorization: 'Bearer u1' } }),
    )
    expect(await signedIn.text()).toBe(compiled.canonical)
  })

  test('a base set for the route is the one the index names', async () => {
    const route = createRouteHandler({ manifest, compiled, base: '/v1' })
    expect(JSON.parse(await index(route)).capabilities.base).toBe('/v1')
  })

  test('private: no field in the index, the manifest is a 404 like any missing path, and v0 still works', async () => {
    const route = createRouteHandler({ manifest, compiled, visibility: 'private' })
    expect(JSON.parse(await index(route))).not.toHaveProperty('capabilities')
    const hidden = await route(request(MANIFEST_PATH))
    const missing = await route(request('/.well-known/affordances/nothing.json'))
    expect([hidden.status, (await hidden.text()).replace(MANIFEST_PATH, 'X')]).toEqual([
      missing.status,
      (await missing.text()).replace('/.well-known/affordances/nothing.json', 'X'),
    ])
    // views and calls are unchanged
    expect(
      (await route(request('/', { headers: { accept: 'application/vnd.affordances+json' } })))
        .status,
    ).toBe(200)
    const call = await route(
      request('/', {
        method: 'POST',
        body: JSON.stringify({ action: 'bump', input: {} }),
        headers: { 'content-type': 'application/vnd.affordances+json' },
      }),
    )
    expect((await call.json()) as unknown).toMatchObject({ ok: true })
  })
})

import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { generate } from '@affordances/next/codegen'
import { expect, test, vi } from 'vitest'
import { v0Bindings } from '../src/v0-bindings.ts'

// the v0 table M7f's v0 cell replays by is the app's own: every v0 action the generated manifest serves, with the
// capability its defineAction binds, read from the action itself

// the actions' revalidatePath needs Next's request store, which isn't here
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

const key = (b: { route: string; action: string }) => `${b.route} ${b.action}`

test('v0Bindings is exactly the app’s v0 actions and the capabilities they bind', async () => {
  const root = path.join(import.meta.dirname, '..')
  generate(root)
  const { manifest } = (await import(
    pathToFileURL(path.join(root, '.affordances', 'manifest.ts')).href
  )) as {
    manifest: {
      routes: Record<string, { actions: Record<symbol, { id?: string; name: string }>[] }>
    }
  }
  const served = Object.entries(manifest.routes).flatMap(([route, { actions }]) =>
    actions.map((a) => {
      const meta = a[Symbol.for('affordances.action')]!
      return { route, action: meta.name, capability: meta.id }
    }),
  )
  expect(served.toSorted((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0))).toEqual(
    [...v0Bindings].toSorted((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0)),
  )
})

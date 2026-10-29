import { NodeServices } from '@effect/platform-node'
import { Effect } from 'effect'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { init } from '../src/project.ts'

// a scratch Next app: an app/ dir and, optionally, a config
const app = (config?: string) => {
  const root = mkdtempSync(path.join(tmpdir(), 'affordances-cli-'))
  mkdirSync(path.join(root, 'app'))
  if (config !== undefined) writeFileSync(path.join(root, 'next.config.ts'), config)
  return root
}
const run = (root: string) => Effect.runPromise(init(root).pipe(Effect.provide(NodeServices.layer)))
const read = (root: string, file: string) => readFileSync(path.join(root, file), 'utf8')

test('init sets an app up, and running it again keeps everything', async () => {
  const root = app('const nextConfig = {}\nexport default nextConfig\n')
  const first = await run(root)
  expect(first.steps.map((s) => s.status)).toEqual(['wrote', 'wrapped', 'wrote', 'wrote'])
  expect(read(root, 'app/api/affordances/graph/[[...path]]/route.ts')).toBe(
    "export { GET, POST } from '@affordances/next/route'\n",
  )
  expect(read(root, 'next.config.ts')).toContain('export default withAffordances(nextConfig)')
  expect(read(root, '.gitignore')).toBe('.affordances\n')

  const second = await run(root)
  expect(second.steps.map((s) => s.status)).toEqual(['kept', 'kept', 'kept', 'wrote'])
  expect(read(root, '.gitignore')).toBe('.affordances\n')
})

test("a config it can't wrap, or no config, becomes a todo instead of an edit", async () => {
  const inline = app('export default { reactCompiler: true }\n')
  expect((await run(inline)).steps[1]).toMatchObject({ status: 'todo', path: 'next.config.ts' })
  expect(read(inline, 'next.config.ts')).toBe('export default { reactCompiler: true }\n')

  expect((await run(app())).steps[1]).toMatchObject({ status: 'todo' })
})

test('an existing .gitignore gets the entry on its own line', async () => {
  const root = app()
  writeFileSync(path.join(root, '.gitignore'), 'node_modules')
  await run(root)
  expect(read(root, '.gitignore')).toBe('node_modules\n.affordances\n')
})

test('outside a Next app, init fails with NoApp before writing anything', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'affordances-cli-'))
  const error = await Effect.runPromise(
    init(root).pipe(Effect.flip, Effect.provide(NodeServices.layer)),
  )
  expect(error._tag).toBe('NoApp')
})

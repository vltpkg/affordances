import { execFileSync, spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'

// intake's rulings (2026-11-18 10:10Z and 10:40Z): @affordances/ir and @affordances/runtime are next's optional peers,
// so an app that never installs them typechecks with skipLibCheck: false and builds against next's main entry,
// exactly as a v0 app did. The app sits outside this repo, with next as a published copy of a fresh build and next's
// own dependencies linked in, but neither peer.
// Written by backend, for design's /author packet

const pkg = path.join(import.meta.dirname, '..')
const repo = path.join(pkg, '..', '..')
let app: string
let built: string

// a link in the app's node_modules to where the workspace has a package, through its realpath
const link = (name: string, from: string) => {
  const target = realpathSync(path.join(from, 'node_modules', name))
  mkdirSync(path.dirname(path.join(app, 'node_modules', name)), { recursive: true })
  symlinkSync(target, path.join(app, 'node_modules', name), 'dir')
}

beforeAll(() => {
  // a fresh build of next into a scratch dir of its own, never the shared dist/, which dist.test builds into
  built = mkdtempSync(path.join(tmpdir(), 'affordances-next-build-'))
  execFileSync(path.join(repo, 'node_modules', '.bin', 'tsdown'), ['--out-dir', built], {
    cwd: pkg,
    stdio: 'ignore',
  })
  app = mkdtempSync(path.join(tmpdir(), 'affordances-no-ir-app-'))
  // next as an app installs it: its package.json and its dist, copied
  const installed = path.join(app, 'node_modules', '@affordances', 'next')
  mkdirSync(installed, { recursive: true })
  cpSync(path.join(pkg, 'package.json'), path.join(installed, 'package.json'))
  cpSync(built, path.join(installed, 'dist'), { recursive: true })
  // next's own dependencies, and the peers an app has (next, react); never @affordances/ir
  for (const dep of ['@affordances/core', '@affordances/protocol', 'oxc-parser', 'next', 'react'])
    link(dep, pkg)
  writeFileSync(
    path.join(app, 'package.json'),
    JSON.stringify({ name: 'no-ir-app', type: 'module' }),
  )
  writeFileSync(
    path.join(app, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        skipLibCheck: false,
        module: 'nodenext',
        moduleResolution: 'nodenext',
        target: 'es2023',
        types: [],
        outDir: 'out',
      },
      files: ['app.ts'],
    }),
  )
  writeFileSync(
    path.join(app, 'app.ts'),
    [
      "import * as affordances from '@affordances/next'",
      'const names: string[] = Object.keys(affordances)',
      'console.log(JSON.stringify({ loaded: names.length > 0 }))',
    ].join('\n'),
  )
}, 180_000)

afterAll(() => {
  rmSync(app, { recursive: true, force: true })
  rmSync(built, { recursive: true, force: true })
})

test('the app really has no @affordances/ir and no @affordances/runtime: neither resolves from the app’s root', () => {
  for (const peer of ['@affordances/ir', '@affordances/runtime'])
    expect(() => createRequire(path.join(app, 'package.json')).resolve(peer)).toThrow(
      /Cannot find module/,
    )
})

// the second optional peer (intake, 2026-11-18): an app that uses /projection without runtime gets one error naming it
// /projection's first request, in the app, as node runs it in development, so the approval defaults apply
const firstRequest = () =>
  spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      [
        "const { createProjectionRoute } = await import('@affordances/next/projection')",
        'const route = createProjectionRoute({ manifest: {}, bindings: {}, resources: {}, principal: () => ({ authenticated: false, attributes: {} }) })',
        "await route.GET(new Request('https://app.test/api/projection')).catch((e) => { console.log(e.message); process.exit(3) })",
      ].join('\n'),
    ],
    { cwd: app, encoding: 'utf8', env: { ...process.env, NODE_ENV: 'development' } },
  )

test('without runtime, /projection loads, and its first request fails with one error naming the peer', () => {
  const run = firstRequest()
  expect({ status: run.status, out: run.stdout.trim() }).toEqual({
    status: 3,
    out: "@affordances/next/projection needs @affordances/runtime, next's optional peer: install it beside @affordances/next",
  })
}, 60_000)

// review of b96dee48: a runtime that's installed but misses one of its own imports names runtime's path in its error;
// that's rethrown as it is, never relabelled as a missing peer
test('an installed runtime missing its own dependency is reported as that, not as a missing peer', () => {
  const runtime = path.join(app, 'node_modules', '@affordances', 'runtime')
  mkdirSync(runtime, { recursive: true })
  writeFileSync(
    path.join(runtime, 'package.json'),
    JSON.stringify({ name: '@affordances/runtime', type: 'module', exports: './index.js' }),
  )
  writeFileSync(path.join(runtime, 'index.js'), "export * from 'a-missing-dependency'\n")
  try {
    const run = firstRequest()
    expect(run.status).toBe(3)
    expect(run.stdout).toMatch(/Cannot find package 'a-missing-dependency'/)
    expect(run.stdout).not.toMatch(/optional peer/)
  } finally {
    rmSync(runtime, { recursive: true, force: true })
  }
}, 60_000)

test('an app without ir typechecks against next’s main entry with skipLibCheck: false, and builds', () => {
  const tsc = spawnSync(path.join(repo, 'node_modules', '.bin', 'tsc'), ['-p', app], {
    cwd: app,
    encoding: 'utf8',
  })
  expect({ status: tsc.status, output: tsc.stdout + tsc.stderr }).toEqual({ status: 0, output: '' })
  // and it builds: tsc emits the app. It isn't run: next's main entry imports next/headers, which only Next's own
  // bundler resolves, so running it outside Next proves nothing about ir
  expect(existsSync(path.join(app, 'out', 'app.js'))).toBe(true)
}, 120_000)

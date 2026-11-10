// the server suite on each Next version md supports: test/server's app, built and started with next start against
// @affordances/md as published (its packed dist), then asked for each twin. md's answers are the same on every
// version, so one table holds for all of them; a Next that changes something md reads must fail closed, which the
// table says too. run after `vlt run build`:
//
//   node test/server/matrix.ts                  the tested versions
//   node test/server/matrix.ts 16.5.0-canary.50  any others
//
// installs are kept under the system temp dir, one per version, so a rerun only reinstalls md
import { execFileSync, spawn } from 'node:child_process'
import { cpSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// the versions the README lists
const TESTED = [
  '16.0.0',
  '16.0.11',
  '16.1.7',
  '16.2.12',
  '16.3.0',
  '16.3.8',
  '16.4.6',
  '16.5.0-canary.46',
]

type Check = {
  path: string
  headers?: Record<string, string>
  status: number
  // each header's value, or null for one that isn't there
  expect?: Record<string, string | null>
  // text the body has
  body?: string
  // text it never has
  not?: string
}

const PUBLIC = 's-maxage=3600, stale-while-revalidate=82800'
const PRIVATE = 'private, no-store'
const checks: Check[] = [
  { path: '/ok.md', status: 200, expect: { 'cache-control': PUBLIC }, body: '# Fine' },
  // negotiated markdown is never public
  {
    path: '/ok',
    headers: { accept: 'text/markdown' },
    status: 200,
    expect: { 'cache-control': PRIVATE },
  },
  // a boundary that caught an error: its status, never public, though its route opted in
  {
    path: '/boom.md',
    status: 200,
    expect: { 'cache-control': PRIVATE, 'x-affordances-md-error': '1' },
  },
  // streamed after the shell, which next sends as a 200
  { path: '/gone.md', status: 404, expect: { 'cache-control': PRIVATE }, not: '# Item' },
  { path: '/moved.md', status: 307, expect: { location: '/ok.md', 'cache-control': PRIVATE } },
  // prerendered, with notFound() in a boundary
  { path: '/static-gone.md', status: 404, expect: { 'cache-control': PRIVATE } },
  // next start builds request.url from its own host, never the Host a caller sends, so the page is fetched from the
  // server itself. the page itself sees the caller's Host, so it was sent
  { path: '/host', headers: { host: 'evil.test' }, status: 200, body: '<h1>evil.test</h1>' },
  {
    path: '/ok.md',
    headers: { host: 'evil.test' },
    status: 200,
    body: '# Fine',
    not: 'evil.test',
  },
  {
    path: '/llms-full.txt',
    status: 200,
    expect: { 'cache-control': 'public, max-age=0, s-maxage=3600' },
  },
  {
    path: '/llms-errored.txt',
    status: 503,
    expect: { 'cache-control': 'no-store', 'x-affordances-md-dropped': '1' },
  },
]

const md = fileURLToPath(new URL('../..', import.meta.url))
const app = fileURLToPath(new URL('.', import.meta.url))
const cache = join(tmpdir(), 'affordances-md-matrix')

const run = (command: string, args: string[], cwd: string) =>
  execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

const freePort = () =>
  new Promise<number>((resolve) => {
    const server = createServer().listen(0, () => {
      const { port } = server.address() as { port: number }
      server.close(() => resolve(port))
    })
  })

// the app on this version, with md as packed: what a project that installs it gets
const install = (version: string, tarball: string) => {
  const dir = join(cache, version)
  mkdirSync(dir, { recursive: true })
  for (const entry of readdirSync(dir))
    if (entry !== 'node_modules') rmSync(join(dir, entry), { recursive: true, force: true })
  cpSync(join(app, 'app'), join(dir, 'app'), { recursive: true })
  cpSync(join(app, 'next.config.mjs'), join(dir, 'next.config.mjs'))
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({
      name: 'md-matrix',
      private: true,
      type: 'module',
      dependencies: {
        next: version,
        react: '^19.3.1',
        'react-dom': '^19.3.1',
        '@affordances/md': `file:${tarball}`,
      },
    }),
  )
  // a prerelease (a canary) is in no semver range, so npm can't match it to md's peer range
  const peers = version.includes('-') ? ['--legacy-peer-deps'] : []
  run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error', ...peers], dir)
  run(join(dir, 'node_modules/.bin/next'), ['build'], dir)
  return dir
}

const start = async (dir: string) => {
  const port = await freePort()
  const server = spawn(join(dir, 'node_modules/.bin/next'), ['start', '-p', String(port)], {
    cwd: dir,
    stdio: 'ignore',
  })
  const base = `http://localhost:${port}`
  for (let i = 0; i < 120; i++) {
    try {
      await fetch(`${base}/ok`)
      return { base, stop: () => server.kill() }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  server.kill()
  throw new Error(`next start didn't answer on ${base}`)
}

// what's wrong with one answer, or nothing
// one request, never following a redirect. node:http, since fetch sends its own Host whatever it's given
const get = (url: string, headers: Record<string, string> = {}) =>
  new Promise<{ status: number; headers: Headers; body: string }>((resolve, reject) => {
    request(url, { headers }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk: string) => (body += chunk))
      response.on('end', () => {
        const all = new Headers()
        for (const [name, value] of Object.entries(response.headers))
          for (const one of [value ?? []].flat()) all.append(name, one)
        resolve({ status: response.statusCode!, headers: all, body })
      })
    })
      .on('error', reject)
      .end()
  })

const problems = async (base: string, check: Check) => {
  const response = await get(`${base}${check.path}`, check.headers)
  const { body } = response
  const wrong: string[] = []
  if (response.status !== check.status) wrong.push(`status ${response.status}, not ${check.status}`)
  for (const [name, value] of Object.entries(check.expect ?? {})) {
    const got = response.headers.get(name)
    if (got !== value) wrong.push(`${name}: ${got}, not ${value}`)
  }
  if (check.body && !body.includes(check.body)) wrong.push(`no ${JSON.stringify(check.body)}`)
  if (check.not && body.includes(check.not)) wrong.push(`has ${JSON.stringify(check.not)}`)
  return wrong
}

const versions = process.argv.slice(2).length ? process.argv.slice(2) : TESTED
mkdirSync(cache, { recursive: true })
const tarball = join(
  cache,
  run('npm', ['pack', '--pack-destination', cache], md).trim().split('\n').at(-1)!,
)
let failed = 0
for (const version of versions) {
  const dir = install(version, tarball)
  const server = await start(dir)
  try {
    for (const check of checks) {
      const wrong = await problems(server.base, check)
      const label = `${check.path}${check.headers ? ` ${JSON.stringify(check.headers)}` : ''}`
      console.log(
        `${wrong.length ? '✗' : '✓'} next ${version} ${label}${wrong.length ? `: ${wrong.join('; ')}` : ''}`,
      )
      if (wrong.length) failed++
    }
  } finally {
    server.stop()
  }
}
console.log(failed ? `${failed} failed` : `all passed on ${versions.join(', ')}`)
process.exitCode = failed ? 1 : 0

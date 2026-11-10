// the server suites on each Next version md supports: test/server's apps (one plain, one with cacheComponents and
// partialPrefetching), each built and started with next start against @affordances/md as published (its packed dist),
// then asked for each twin. md's answers are the same on every version, so one table holds for all of them; a Next
// that changes something md reads must fail closed, which the table says too. run after `vlt run build`:
//
//   node test/server/matrix.ts                  the tested versions
//   node test/server/matrix.ts 16.5.0-canary.50  any others
//
// installs are kept under the system temp dir, one per version, so a rerun only reinstalls md
import { execFileSync, spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
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
  // each header's value, or null for one that isn't there. a location is compared as sent: relative stays relative
  expect?: Record<string, string | null>
  // text the body has
  body?: string
  // text it never has
  not?: string
  // a path whose Cache-Control this one's equals: the page a twin is cached like
  cachedLike?: string
}

const PUBLIC = 's-maxage=3600, stale-while-revalidate=82800'
const PRIVATE = 'private, no-store'
const plain: Check[] = [
  { path: '/ok.md', status: 200, expect: { 'cache-control': PUBLIC }, body: '# Fine' },
  // an anonymous Accept request on a publicCache route is sent to its twin, never stored
  {
    path: '/ok',
    headers: { accept: 'text/markdown' },
    status: 307,
    expect: { location: '/ok.md', 'cache-control': PRIVATE },
  },
  // on a literalMd route, /notes/a.md is the note a.md: Accept on /notes/a gets /notes/a's markdown, never a 307 there
  {
    path: '/notes/a',
    headers: { accept: 'text/markdown' },
    status: 200,
    expect: { location: null, 'cache-control': PRIVATE },
    body: '# Note a',
    not: 'a.md',
  },
  { path: '/notes/a.md', status: 200, body: 'Note a.md' },
  { path: '/llms-notes.txt', status: 200, body: '# Note a' },
  // with credentials it's the person's own markdown, at the page's url, never public
  {
    path: '/ok',
    headers: { accept: 'text/markdown', cookie: 'sid=1' },
    status: 200,
    expect: { 'cache-control': PRIVATE },
    body: '# Fine',
  },
  // a boundary that caught an error: its status, never public, though its route opted in
  {
    path: '/boom.md',
    status: 200,
    expect: { 'cache-control': PRIVATE, 'x-affordances-md-uncached': 'error' },
  },
  // a sanitized README whose attribute holds markup like Flight data and md's own: it stays the link's title
  {
    path: '/readme.md',
    status: 200,
    body: '# left-pad',
    not: '\n# evil-pkg',
  },
  // streamed after the shell, which next sends as a 200
  { path: '/gone.md', status: 404, expect: { 'cache-control': PRIVATE }, not: '# Item' },
  { path: '/moved.md', status: 307, expect: { location: '/ok.md', 'cache-control': PRIVATE } },
  { path: '/forbidden.md', status: 403, expect: { 'cache-control': PRIVATE }, not: '# Item' },
  { path: '/unauthorized.md', status: 401, expect: { 'cache-control': PRIVATE }, not: '# Item' },
  // the route's own notFoundMarkdown, for the same streamed notFound()
  {
    path: '/missing.md',
    status: 404,
    expect: { 'cache-control': PRIVATE },
    body: '# Nothing here',
  },
  // a gate in proxy.js: md.rewrite to another page with a status, and an adopted redirect
  { path: '/flagged.md', status: 404, expect: { 'cache-control': PRIVATE }, body: '# Fine' },
  {
    path: '/flagged.md',
    headers: { 'x-affordances-md-adopt': 'guess;200;/static-gone' },
    status: 404,
    body: '# Fine',
  },
  { path: '/old.md', status: 307, expect: { location: '/ok.md', 'cache-control': PRIVATE } },
  // the gate's own request headers reach the page's markdown.ts, never the client's
  {
    path: '/whoami.md',
    headers: { 'x-user-id': 'victim' },
    status: 200,
    body: 'user=alice adopt=null',
    not: 'victim',
  },
  {
    path: '/who-rw.md',
    status: 200,
    expect: { 'cache-control': PRIVATE },
    body: 'adopt=null via=rewrite',
  },
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
  // a part rendered in the browser by design (dynamic with ssr: false, useSearchParams) isn't an error
  {
    path: '/csr.md',
    status: 200,
    expect: { 'cache-control': PUBLIC, 'x-affordances-md-uncached': null },
    body: '# Charts',
  },
  {
    path: '/sp.md',
    status: 200,
    expect: { 'cache-control': PUBLIC, 'x-affordances-md-uncached': null },
    body: '# Search',
  },
  // under the root catch-all: a page named like a public/ folder keeps its Link, and the folder's file has no twin
  {
    path: '/docs/intro',
    status: 200,
    expect: { link: '</docs/intro.md>; rel="alternate"; type="text/markdown"' },
  },
  { path: '/docs/intro.md', status: 200, body: '# docs/intro' },
  // /ok is a publicCache page, which llms reads at its twin: in the file though the origin isn't request.url's
  {
    path: '/llms-full.txt',
    status: 200,
    body: '# Fine',
    expect: { 'cache-control': 'public, max-age=0, s-maxage=3600' },
  },
  {
    path: '/llms-errored.txt',
    status: 200,
    expect: {
      'cache-control': 'public, max-age=0, s-maxage=3600',
      'x-affordances-md-dropped': null,
    },
    body: '# Fine',
    not: '# Report',
  },
]

// a twin is cached like its page, by next's own caching, with no markdown.ts: a page cached with cacheLife, a static
// one. a filled slot reads data with whatever the request carried, so that twin stays private
const cacheComponents: Check[] = [
  { path: '/cached.md', status: 200, cachedLike: '/cached', body: '# Cached' },
  {
    path: '/cached',
    status: 200,
    expect: { 'cache-control': 's-maxage=86400, stale-while-revalidate=518400' },
  },
  { path: '/static.md', status: 200, cachedLike: '/static', body: '# Static' },
  { path: '/slotted.md', status: 200, expect: { 'cache-control': PRIVATE }, body: 'Filled.' },
  // a profile of the app's own: on the page, its twin follows; in markdown.ts's publicCache, as next would send it
  { path: '/weekly.md', status: 200, cachedLike: '/weekly', body: '# Weekly' },
  {
    path: '/weekly-route.md',
    status: 200,
    expect: { 'cache-control': 's-maxage=604800, stale-while-revalidate=604800' },
  },
  // a url no route matches: next's own not-found page, converted
  { path: '/nope.md', status: 404, body: 'This page could not be found.' },
]

// each app, the page next start is asked for until it answers, and its checks
const suites = [
  { name: 'plain', dir: '.', ready: '/ok', checks: plain },
  { name: 'cache-components', dir: 'cache-components', ready: '/static', checks: cacheComponents },
]

const md = fileURLToPath(new URL('../..', import.meta.url))
const here = fileURLToPath(new URL('.', import.meta.url))
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
const install = (version: string, tarball: string, suite: (typeof suites)[number]) => {
  const dir = join(cache, `${version}-${suite.name}`)
  mkdirSync(dir, { recursive: true })
  for (const entry of readdirSync(dir))
    if (entry !== 'node_modules') rmSync(join(dir, entry), { recursive: true, force: true })
  // npm keeps an installed md whose tarball has the same name and version: always this build's
  rmSync(join(dir, 'node_modules/@affordances'), { recursive: true, force: true })
  rmSync(join(dir, 'package-lock.json'), { force: true })
  const app = join(here, suite.dir)
  cpSync(join(app, 'app'), join(dir, 'app'), { recursive: true })
  cpSync(join(app, 'next.config.mjs'), join(dir, 'next.config.mjs'))
  if (existsSync(join(app, 'proxy.js'))) cpSync(join(app, 'proxy.js'), join(dir, 'proxy.js'))
  if (existsSync(join(app, 'public')))
    cpSync(join(app, 'public'), join(dir, 'public'), { recursive: true })
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

const start = async (dir: string, ready: string) => {
  const port = await freePort()
  // the handler fetches pages from 127.0.0.1 while the checks ask localhost, as behind a proxy where the public host
  // isn't the server's own: nothing md answers may depend on request.url's host
  const server = spawn(join(dir, 'node_modules/.bin/next'), ['start', '-p', String(port)], {
    cwd: dir,
    stdio: 'ignore',
    env: { ...process.env, AFFORDANCES_MD_ORIGIN: `http://127.0.0.1:${port}` },
  })
  const base = `http://localhost:${port}`
  for (let i = 0; i < 120; i++) {
    try {
      await fetch(`${base}${ready}`)
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
  if (check.cachedLike) {
    const page = (await get(`${base}${check.cachedLike}`)).headers.get('cache-control')
    const twin = response.headers.get('cache-control')
    if (twin !== page) wrong.push(`cache-control: ${twin}, not the page's ${page}`)
  }
  return wrong
}

const versions = process.argv.slice(2).length ? process.argv.slice(2) : TESTED
mkdirSync(cache, { recursive: true })
const tarball = join(
  cache,
  run('npm', ['pack', '--pack-destination', cache], md).trim().split('\n').at(-1)!,
)
let failed = 0
for (const version of versions)
  for (const suite of suites) {
    const dir = install(version, tarball, suite)
    const server = await start(dir, suite.ready)
    try {
      for (const check of suite.checks) {
        const wrong = await problems(server.base, check)
        const label = `${suite.name} ${check.path}${check.headers ? ` ${JSON.stringify(check.headers)}` : ''}`
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

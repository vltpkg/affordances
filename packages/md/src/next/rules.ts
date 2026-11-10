// the rules and matchers the markdown rewrites, mdRewrite and the handler share. a leaf: it imports neither the
// converter nor the markdown.ts routes, so @affordances/md/next/proxy stays small
import { mdPath } from '../path.ts'
import {
  builtAliases,
  builtHandlers,
  builtLiteral,
  builtPages,
  compileDestination,
  isPublicFile,
  perEnv,
  routeSegment,
  sourceParams,
  sourceRegex,
} from './routes.ts'

// where the rewrites send markdown requests; `affordances-md init` puts the route handler here
export const MD_PATH = '/api/affordances/md'
// set on the handler's own fetch of the page, so it never gets rewritten back to markdown
export const RENDER_HEADER = 'x-affordances-md-render'
// a gate's rewrite or status, adopted by mdProxy for a markdown request: md()'s per-build token, the gate's status,
// and the page, set on the rewrite's request headers. the handler takes it only with the token
export const ADOPT_HEADER = 'x-affordances-md-adopt'

export type Has = { type: 'header' | 'query'; key: string; value?: string }
export type Rewrite = { source: string; destination: string; has?: Has[]; missing?: Has[] }
export type Rewrites = { beforeFiles: Rewrite[]; afterFiles: Rewrite[]; fallback: Rewrite[] }
export const accepts: Has[] = [{ type: 'header', key: 'accept', value: '.*text/markdown.*' }]
const notOurs: Has[] = [{ type: 'header', key: RENDER_HEADER }]
// not our own render, and not next's client navigations, which ask for the RSC payload with an RSC header and an
// _rsc param. next hides both from a proxy.ts unless skipProxyUrlNormalize is set
export const notOursOrRsc: Has[] = [
  ...notOurs,
  { type: 'header', key: 'rsc' },
  { type: 'query', key: '_rsc' },
]
// pages: not api routes, not next's internals. a dot is fine (/version/5.3.0, /package/chart.js): a file in public/
// still comes back as itself, since the handler passes anything that isn't html through. .md is left to afterFiles,
// so a real .md file in public/ wins
const pagePattern = '(?!api/|_next/)(?!.*\\.md$).+'

export const rewrites = {
  // Accept: text/markdown at the page's own url (browsers never ask for it, so a pattern match is enough). a route
  // handler there (/llms.txt) is passed through by the handler as it is
  beforeFiles: [
    { source: '/', has: accepts, missing: notOursOrRsc, destination: MD_PATH },
    {
      source: `/:path(${pagePattern})`,
      has: accepts,
      missing: notOursOrRsc,
      destination: `${MD_PATH}/:path`,
    },
  ],
  // /blog/post.md and /index.md; afterFiles, so a real .md file in public/ still wins
  afterFiles: [
    { source: '/index.md', missing: notOurs, destination: MD_PATH },
    // never api routes or next's internals, as the Accept rule
    {
      source: '/:path((?!api/|_next/)(?:[^/]+/)*[^/]+)\\.md',
      missing: notOurs,
      destination: `${MD_PATH}/:path`,
    },
  ],
} satisfies Partial<Rewrites>

// the handler's own url prefix, as next matches it: case-insensitive
export const handlerPrefix = new RegExp(`^${MD_PATH}(?=/|$)`, 'i')
// the handler's path for a page: / → /api/affordances/md, /x → /api/affordances/md/x
export const handlerPath = (page: string) => `${MD_PATH}${page === '/' ? '' : page}`

// next's `has` and `missing`: a header or query param that's present, not empty, and matches the value pattern if
// there is one
// each rule's value compiled once: mdRewrite runs on every request a proxy.ts sees
const patterns = new Map<string, RegExp>()
const pattern = (value: string) => {
  const compiled = patterns.get(value) ?? new RegExp(`^${value}$`)
  patterns.set(value, compiled)
  return compiled
}
export const present = (request: Request, url: URL, { type, key, value }: Has) => {
  const actual = type === 'query' ? url.searchParams.get(key) : request.headers.get(key)
  return Boolean(actual) && (!value || pattern(value).test(actual!))
}
export const matches = (request: Request, url: URL, { has = [], missing = [] }: Partial<Rewrite>) =>
  has.every((h) => present(request, url, h)) && !missing.some((h) => present(request, url, h))

// the rewrites' paths as regexes; the header and query conditions are read off the rules themselves
export const pageRegex = new RegExp(`^/(?:${pagePattern})$`, 'i')
export const isPage = (pathname: string) => pathname === '/' || pageRegex.test(pathname)
export const suffixRegex = /^\/(?!api\/|_next\/)(?:[^/]+\/)*[^/]+\.md$/i

// a .md path on a md({ literalMd }) route, which may be a page of its own (/package/readme.md) or a twin
// compiled once per value of the env next inlined: mdRewrite runs on every request a proxy.ts sees
const literal = perEnv(() => builtLiteral().map((source) => sourceRegex(source)))
// spelled out: next inlines process.env.NAME, never process.env[name]
const literalRoutes = () => literal(process.env.AFFORDANCES_MD_LITERAL)
// matched against the url as it was requested, like the rewrites these sources feed: list a public shape an alias maps
// (/package/@:scope/:name) as it is, not the route it maps onto
export const isLiteral = (pathname: string) => {
  const routes = literalRoutes()
  return (
    routes.length > 0 && /\.md$/i.test(pathname) && routes.some((route) => route.test(pathname))
  )
}

// md({ aliases }), each compiled once per value of the env next inlined
const aliases = perEnv(() =>
  builtAliases().map(([source, destination]) => ({
    regex: sourceRegex(source, ''),
    names: sourceParams(source),
    fill: compileDestination(destination),
  })),
)
// spelled out: next inlines process.env.NAME, never process.env[name]
const aliasRules = () => aliases(process.env.AFFORDANCES_MD_ALIASES)
// a path next routes no page to: one with an empty segment (//, a trailing /), which strict matching never takes
const emptySegment = (pathname: string) =>
  pathname !== '/' && pathname.split('/').slice(1).includes('')

// the app/ route url a public url renders, from the first alias whose source matches it, or undefined. matched as
// strictly as next routes a page (case-sensitive, no empty segment), so a url a proxy.ts matcher might miss
// (/Package/@a/b) never stands for the route
export const aliasPath = (pathname: string): string | undefined => {
  if (emptySegment(pathname)) return undefined
  for (const { regex, names, fill } of aliasRules()) {
    const match = regex.exec(pathname)
    if (match) return fill(Object.fromEntries(names.map((name, i) => [name, match[i + 1]])))
  }
  return undefined
}

export const LINK = 'rel="alternate"; type="text/markdown"'

// where a redirect answering a markdown request goes: a same-origin target's .md twin, with its search, or undefined
// for another origin, which is passed on as it is. a twin path that starts with //host (a return-to of /.//evil.test/x
// is same-origin) gets /. so a client resolves it as a path on this site, never as another site
export const twinLocation = (target: URL, from: URL) => {
  // only a page that has a twin: an api route, a route handler (/auth/login) or a file stays as it is
  if (target.origin !== from.origin || !hasTwin(target.pathname)) return undefined
  const twin = mdPath(target.pathname)
  return `${twin.startsWith('//') ? '/.' : ''}${twin}${target.search}`
}
export const apiRoute = /^\/api(\/|$)/i

// a route's segments ranked as next ranks them: static, then [param], then [...catchAll], then [[...optional]]
const RANK = { static: 0, one: 1, some: 2, any: 3 }
const rank = (segment: string) => RANK[routeSegment(segment).kind]
const byRank = (a: string, b: string) => {
  const [x, y] = [a.split('/').slice(1), b.split('/').slice(1)]
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const order = rank(x[i] ?? '') - rank(y[i] ?? '')
    if (order) return order
  }
  return y.length - x.length
}
// a param as next gives it to the page: still encoded, in next's own encoding (x=1 is x%3D1)
const asParam = (segment: string) => {
  try {
    return encodeURIComponent(decodeURIComponent(segment))
  } catch {
    return segment
  }
}
// a route as next ranks and matches it: its segments, read once, and whether it's a route handler (/llms.txt) rather
// than a page
type Ranked = {
  route: string
  handler: boolean
  segments: { segment: string; kind: keyof typeof RANK; name: string }[]
  whole: boolean
}
const compile = (route: string, handler: boolean): Ranked => {
  const segments = route
    .split('/')
    .slice(1)
    .filter(Boolean)
    .map((segment) => ({ segment, ...routeSegment(segment) }))
  // a catch-all takes the rest of the path; otherwise the path has as many segments as the route
  return { route, handler, segments, whole: segments.some(({ kind }) => RANK[kind] >= 2) }
}
// a route's params for a path's segments, or undefined when it isn't that route's
const routeParams = ({ segments, whole }: Ranked, parts: string[], strict: boolean) => {
  const params: Record<string, string | string[]> = {}
  const matched = segments.every(({ segment, kind, name }, i) => {
    if (kind === 'some' || kind === 'any') {
      const rest = parts.slice(i)
      if (rest.length) params[name] = rest.map(asParam)
      return rest.length > 0 || kind === 'any'
    }
    if (kind === 'one') {
      if (!parts[i]) return false
      params[name] = asParam(parts[i]!)
      return true
    }
    return strict ? parts[i] === segment : parts[i]?.toLowerCase() === segment.toLowerCase()
  })
  return matched && (whole || parts.length === segments.length) ? params : undefined
}

// md()'s pages and route handlers, and the given routes, in next's order, so a route handler and a page are the same
// question next answers (/llms.txt before /[...slug], /og/about before /og/[slug]). compiled once per value of the
// env and the routes
const ranked = perEnv((routes: string[]) => {
  const handlers = new Set(builtHandlers())
  return [...new Set([...builtPages(), ...handlers, ...routes])]
    .toSorted(byRank)
    .map((route) => compile(route, handlers.has(route)))
})
// spelled out: next inlines process.env.NAME, never process.env[name]
const rankedRoutes = (routes: string[]) =>
  ranked(
    `${process.env.AFFORDANCES_MD_ROUTES}\0${process.env.AFFORDANCES_MD_HANDLERS}\0${routes.join('\0')}`,
    routes,
  )

const internal = /^\/(?:api|_next)(?:\/|$)/i
// the page a pathname is, among md()'s pages (and any routes given), with its params: through the first alias that
// matches, never an api route or next's internals. strict, for markdown.ts, as next's own page routing is:
// case-sensitive, segments compared and passed on as requested (next gives a page its params encoded too), and no
// empty segment (//, a trailing /); the rewrites match loosely, so /Dashboard/1.md or /%64ashboard/1.md can reach the
// handler without a path-scoped proxy.ts matcher seeing it, and those never get a markdown.ts. loose, for twins, as
// next's rewrites match: case-insensitive
export const pageRoute = (
  pathname: string,
  { strict, routes = [] }: { strict: boolean; routes?: string[] },
) => {
  const routed = aliasPath(pathname) ?? pathname
  if (internal.test(pathname) || internal.test(routed)) return undefined
  if (strict && emptySegment(routed)) return undefined
  const parts = routed === '/' ? [] : routed.split('/').slice(1)
  for (const candidate of rankedRoutes(routes)) {
    const params = routeParams(candidate, parts, strict)
    if (params) return { route: candidate.route, params, handler: candidate.handler }
  }
  return undefined
}

// whether a url on this site has a markdown twin: a page url (not an api route, next's internals or a .md file, except
// a literalMd page) that is one of md()'s pages or maps onto one through an alias. without md()'s pages (withMd left
// out, a test) every page url does
// a route handler that next routes the url to (/llms.txt), or a file in public/ (/openapi.json), is never a page with a
// twin
export const hasTwin = (pathname: string) => {
  const path = pathname.replace(/(.)\/$/, '$1')
  if (!(path === '/' || pageRegex.test(path) || isLiteral(path))) return false
  // a file in public/, which next serves before a dynamic page could answer for it
  if (isPublicFile(path)) return false
  if (!builtPages().length) return true
  const found = pageRoute(path, { strict: false })
  return found !== undefined && !found.handler
}

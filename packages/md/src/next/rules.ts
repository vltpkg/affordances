// the rules and matchers the markdown rewrites, mdRewrite and the handler share. a leaf: it imports neither the
// converter nor the markdown.ts routes, so @affordances/md/next/proxy stays small
import { builtLiteral, sourceRegex } from './routes.ts'

// where the rewrites send markdown requests; `affordances-md init` puts the route handler here
export const MD_PATH = '/api/affordances/md'
// set on the handler's own fetch of the page, so it never gets rewritten back to markdown
export const RENDER_HEADER = 'x-affordances-md-render'

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
  // Accept: text/markdown at the page's own url (browsers never ask for it, so a pattern match is enough)
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
let literalCache: { key: string | undefined; routes: RegExp[] } | undefined
const literalRoutes = () => {
  // spelled out: next inlines process.env.NAME, never process.env[name]
  const key = process.env.AFFORDANCES_MD_LITERAL
  if (!literalCache || literalCache.key !== key)
    literalCache = { key, routes: builtLiteral().map(sourceRegex) }
  return literalCache.routes
}
export const isLiteral = (pathname: string) =>
  /\.md$/i.test(pathname) && literalRoutes().some((route) => route.test(pathname))

export const LINK = 'rel="alternate"; type="text/markdown"'
export const apiRoute = /^\/api(\/|$)/i

// with its .js, as proxy.ts imports it: next.config loads this entry in plain node
import { NextRequest } from 'next/server.js'
import {
  escapeRegExp,
  FlightDataError,
  flightStripper,
  fromDigest,
  headingOf,
  type Page,
  pageTitle,
  readStreamed,
  relinkMarkdown,
  type SlotNames,
  TITLE_SEPARATORS,
  yaml,
} from '../convert/index.ts'
import { mdPath } from '../path.ts'
import { CACHE_LIFE_ENV, cacheLifeEnv, customProfiles, publicCacheControl } from './cache.ts'
import { mdPagePath } from './proxy.ts'
import {
  ALIASES_ENV,
  builtPages,
  checkAliases,
  HANDLERS_ENV,
  PUBLIC_ENV,
  publicPattern,
  LITERAL_ENV,
  once,
  ROUTES_ENV,
  scanApp,
  scanPublic,
  adoptToken,
  sourceRegex,
  linkSources,
  toSource,
  writeMarkdownRoutes,
} from './routes.ts'
import {
  accepts,
  ADOPT_HEADER,
  hasTwin,
  pageRoute,
  apiRoute,
  handlerPrefix,
  isLiteral,
  LINK,
  MD_PATH,
  notOursOrRsc,
  present,
  RENDER_HEADER,
  rewrites,
  twinLocation,
  type Rewrite,
  type Rewrites,
} from './rules.ts'

// the proxy side, implemented once in ./proxy.ts (@affordances/md/next/proxy)
export {
  isMdRequest,
  MD_PATH,
  mdAliasPath,
  mdLink,
  mdPagePath,
  mdPath,
  mdProxy,
  type MdProxy,
  mdRewrite,
  RENDER_HEADER,
  rewrites,
  type Has,
  type Rewrite,
  type Rewrites,
} from './proxy.ts'

export type Header = { source: string; headers: { key: string; value: string }[] }
export type Config = {
  rewrites?: () => Promise<unknown> | unknown
  headers?: () => Promise<Header[]> | Header[]
  env?: Record<string, string | undefined>
  // where next build writes, for the token's cache folder
  distDir?: string
  // the slice md() touches; as loose as next's own type (an interface with no index signature), so a NextConfig fits
  turbopack?: { resolveAlias?: Record<string, unknown> }
  // typed loosely: its context drags in all of NextConfig, which two copies of next don't agree on
  // oxlint-disable-next-line no-explicit-any
  webpack?: ((config: any, context: any) => any) | null
  // read for markdown.ts's publicCache, which names a profile or gives the same times
  cacheLife?: Record<string, { stale?: number; revalidate?: number; expire?: number }>
  expireTime?: number
  experimental?: { cacheLife?: unknown }
}

const normalize = (value: unknown): Rewrites =>
  Array.isArray(value)
    ? { beforeFiles: [], afterFiles: value as Rewrite[], fallback: [] }
    : {
        beforeFiles: [],
        afterFiles: [],
        fallback: [],
        ...(value as Partial<Rewrites> | undefined),
      }

// a page's last param as one that never ends in .md, so a page's own twin (/docs/x.md on /docs/:slug+) doesn't
// match its rule and get pointed at /docs/x.md.md
const notTwin = (source: string) =>
  source.replace(
    /(?<!\\):(\w+)\+?$/,
    (whole, name: string) => `:${name}((?!.*\\.md$)${whole.endsWith('+') ? '.+' : '[^/]+'})`,
  )

// a source whose first segment is a param, kept off api routes and next's internals as the rewrites are: a root
// catch-all (/:slug+) would otherwise put a page's Link on /api/cart and /_next/static/…
const notInternal = (source: string) =>
  source.replace(
    /^\/:(\w+)(?:\((.*)\))?/,
    (_, name: string, own?: string) =>
      // a lookahead's $ is the whole path's end, so a segment's end is spelled (?:/|$)
      `/:${name}((?!(?:api|_next)(?:/|$))${own ?? '[^/]+'})`,
  )
// public/'s files take back the Link a page's rule gave them (a root catch-all's, /docs/[slug]'s): one rule after
// md()'s own, on the pattern hasTwin reads too, so a file never says it has a twin it doesn't have
const publicLinks = (files: string[]): Header[] => {
  const pattern = publicPattern(files)
  return pattern ? [{ source: `/:file(${pattern})`, headers: [{ key: 'Link', value: '' }] }] : []
}

// the Link rules for a source, a page's (/products/:slug) or an alias's (/package/@:scope/:name): one per way its
// optional params can be there (linkSources), each kept off its own twin and off api routes and next's internals.
// notTwin makes a repeated last param one patterned param, which a value fills as :name. undefined when next can't
// fill a value from the source
const linkRules = (source: string) =>
  linkSources(source)?.map(({ source: part, template }) => {
    const guarded = notInternal(notTwin(part))
    const filled = guarded === notInternal(part) ? template : template.replace(/:(\w+)\+$/, ':$1')
    return {
      source: guarded,
      value: `<${mdPath(filled).replace(/[?#\\]/g, encodeURIComponent)}>; ${LINK}`,
    }
  })

// each page's Link header: /products/[slug] → </products/:slug.md>, filled in by next per request
const alternates = (pages: string[]) =>
  pages
    .filter((route) => !apiRoute.test(route))
    .map((route) => ({ source: toSource(route), parts: linkRules(toSource(route)) ?? [] }))

// each alias's Link header, on its public source: '/package/@:scope/:name' → </package/@:scope/:name.md>, the same
// whichever alias matches. a source next can't fill a value from gets none, and md() says so
const aliasAlternates = (aliases: Record<string, string>): Header[] =>
  Object.keys(aliases).flatMap((source) => {
    const rules = linkRules(source)
    if (!rules)
      console.warn(
        `[affordances-md] md({ aliases }): '${source}' gets no Link header: Next can't put an unnamed param in a header, and more than three optional params would take a rule for each way they combine. Name each param (:name(pattern)).`,
      )
    return (rules ?? []).map(({ source: part, value }) => ({
      source: part,
      headers: [{ key: 'Link', value }],
    }))
  })

// a rule already setting Link on a page's source (Affordances' rel="affordances") gets ours appended, split into
// the same parts: next keeps only the last value of a header two rules set, so a separate rule would replace it
const withAlternates = (
  user: Header[],
  pages: string[],
  aliases: Record<string, string>,
  files: string[] = [],
): Header[] => {
  const bySource = new Map(alternates(pages).map(({ source, parts }) => [source, parts]))
  const claimed = new Set<string>()
  // new rules, never the app's own changed in place. every rule setting Link on the source gets it, since the last wins
  const merged = user.flatMap((rule) => {
    const parts = rule.headers.some(isLink) ? bySource.get(rule.source) : undefined
    if (!parts) return [rule]
    claimed.add(rule.source)
    return parts.map(({ source, value }) => ({
      ...rule,
      source,
      headers: rule.headers.map((h) => (isLink(h) ? { ...h, value: `${h.value}, ${value}` } : h)),
    }))
  })
  const own = [...bySource]
    .filter(([source]) => !claimed.has(source))
    .flatMap(([, parts]) => parts)
    .map(({ source, value }) => ({ source, headers: [{ key: 'Link', value }] }))
  // first, so a Link the app sets itself on a broader source still wins; an alias's after a page's, since it's the
  // public url's own
  return [...own, ...aliasAlternates(aliases), ...publicLinks(files), ...merged]
}
const isLink = (header: { key: string }) => header.key.toLowerCase() === 'link'

export type MdOptions = {
  // the project root, to find app/; defaults to the directory next runs in
  root?: string
  // Link: </x.md>; rel="alternate"; type="text/markdown" on every page, so agents can find the markdown
  link?: boolean
  // routes whose pages' own urls may end in .md, as next sources (['/package/:name']): there /x/readme.md is the page
  // readme.md when it exists, and the twin of /x/readme when it 404s. costs that 404 render on each twin request
  literalMd?: string[]
  // public url shapes your proxy.ts or rewrites map onto app/ routes, in next's rewrite syntax: source → the url the
  // route answers. { '/package/@:scope/:name/:rest*': '/package/@:scope%2F:name/:rest*' } lets /package/@babel/core
  // get its Link header, twin links and app/package/[pkg]/markdown.ts. the first that matches wins
  aliases?: Record<string, string>
}

// a next config wrapper, like createMDX(): md()(config), or withAffordances(config, { plugins: [md()] })
export const md =
  ({ root = process.cwd(), link = true, literalMd = [], aliases = {} }: MdOptions = {}) =>
  <C extends Config>(config: C): C => {
    // read once, when next loads its config; a page or markdown.ts added during next dev shows up after a restart
    // the cacheLife profiles a publicCache can name, next's own and next.config's
    // next.config's cacheLife, where next reads it: experimental.cacheLife, which next 16 still takes, replaces the
    // top-level one (config.js warnOptionHasBeenMovedOutOfExperimental, 16.3.0 and 16.4.3)
    const life =
      config.experimental && 'cacheLife' in config.experimental
        ? config.experimental.cacheLife
        : config.cacheLife
    const profiles = customProfiles(life)
    const { pages, markdown, problems, handlers } = scanApp(root)
    const files = scanPublic(root)
    const generated = writeMarkdownRoutes(root, markdown, problems, profiles)
    const cacheLife = cacheLifeEnv(life, config.expireTime)
    // a source next would reject throws here, not on the first request
    for (const source of literalMd) sourceRegex(source)
    checkAliases(aliases, pages)
    const aliased = Object.entries(aliases)
    return {
      ...config,
      env: {
        ...config.env,
        [ROUTES_ENV]: JSON.stringify(pages),
        ...(handlers.length && { [HANDLERS_ENV]: JSON.stringify(handlers) }),
        ...(files.length && { [PUBLIC_ENV]: JSON.stringify(files) }),
        ...(cacheLife && { [CACHE_LIFE_ENV]: cacheLife }),
        ...(literalMd.length && { [LITERAL_ENV]: JSON.stringify(literalMd) }),
        ...(aliased.length && { [ALIASES_ENV]: JSON.stringify(aliased) }),
        // the token mdProxy's adopt and rewrite carry a gate's answer to the handler with: new on each config load, the
        // same in the proxy and the handler of one build
        [ADOPT_ENV]: adoptToken(root, config.distDir),
      },
      rewrites: async () => {
        const user = normalize(await config.rewrites?.())
        // after whatever came first (e.g. Affordances' graph rewrites), so each keeps its own media type
        return {
          ...user,
          // a literal route's page that ends in .md, asked for with Accept: the general rule leaves .md to afterFiles,
          // which a static page of that name would beat
          beforeFiles: [
            ...user.beforeFiles,
            ...rewrites.beforeFiles,
            ...literalMd.map((source) => ({
              source,
              has: accepts,
              missing: notOursOrRsc,
              destination: MD_PATH,
            })),
          ],
          afterFiles: [...rewrites.afterFiles, ...user.afterFiles],
        }
      },
      headers: async () => {
        const user = (await config.headers?.()) ?? []
        return link ? withAlternates(user, pages, aliases, files) : user
      },
      // the handler imports @affordances/md/routes; point it at this app's generated one
      ...(generated && {
        turbopack: {
          ...config.turbopack,
          // turbopack takes a path relative to the project (md()'s root), not an absolute one, nor one from the cwd,
          // which differs when next runs another directory (next dev apps/web)
          resolveAlias: {
            ...config.turbopack?.resolveAlias,
            '@affordances/md/routes': `./${process.getBuiltinModule('node:path').relative(root, generated)}`,
          },
        },
        // oxlint-disable-next-line no-explicit-any
        webpack: (webpack: any, context: any) => {
          webpack.resolve.alias['@affordances/md/routes'] = generated
          return config.webpack ? config.webpack(webpack, context) : webpack
        },
      }),
    }
  }

export const withMd = <C extends Config>(config: C, options?: MdOptions): C => md(options)(config)

// for generateMetadata: { alternates: mdAlternate('/blog/post') }
export const mdAlternate = (path: string) => ({ types: { 'text/markdown': mdPath(path) } })

// a same-origin link to one of md()'s pages, as that page's twin with its search and hash. other origins, api
// routes, next's internals and links already ending in .md stay as they are (hasTwin); without md()'s pages, every
// link does
const twinLinks = (base: URL) => {
  if (!builtPages().length) return undefined
  // a page links the same path many times (a nav, a footer): asked once each
  const twins = new Map<string, boolean>()
  return (url: URL) => {
    if (url.origin !== base.origin) return
    const twinned = twins.get(url.pathname) ?? hasTwin(url.pathname)
    twins.set(url.pathname, twinned)
    if (!twinned) return
    // set on the url itself, so a path that starts with //host (/.//evil.test/x resolves to one) stays a path here
    const twin = new URL(url)
    twin.pathname = mdPath(url.pathname)
    return twin.href
  }
}

export type MdHandlerOptions = {
  // where to fetch pages from; defaults to the request's own origin, or AFFORDANCES_MD_ORIGIN behind a proxy
  origin?: string
  timeout?: number
  maxBytes?: number
  // more headers on the handler's own fetch of the page, after the caller's forwarded ones (a cookie or authorization
  // here only when the caller sent neither), e.g.
  // x-vercel-protection-bypass for a protected preview
  headers?: HeadersInit | ((request: Request) => HeadersInit | Promise<HeadersInit>)
  // more markdown after the page's, e.g. an Affordances graph summary
  append?: (request: Request) => Promise<string | undefined> | string | undefined
  // links to the site's own pages (the ones md() found) point at their markdown twins, so an agent stays in markdown
  linkTwins?: boolean
}

const FORWARD = ['cookie', 'authorization', 'accept-language']
// the request a public view sees, the same for every visitor: none of their headers (language, user agent, country).
// md's own NextRequest (nextUrl, cookies), since in a built app next's is another copy of the class
const viewRequest = (request: Request) =>
  new NextRequest(request.url, { method: request.method, signal: request.signal })

// set on markdown converted from a page that hadn't finished streaming by the timeout
export const PARTIAL_HEADER = 'x-affordances-md-partial'
// set on markdown that's private for a personal reason (credentials, a private page, a cookie set in answer), not just
// because of where it was served: llms reads it to leave such a page out of its public files
const PERSONAL_HEADER = 'x-affordances-md-personal'

// the page's html as far as it streams before the deadline, without its flight pushes, which are read for their error
// rows as they come and never held: maxBytes is the html the converter keeps, so a partialPrefetching page's flight
// data (most of its bytes) costs no memory. { whole } past maxBytes, or past RAW times it in all; complete is false
// when the deadline or a broken stream cut it short
const RAW = 8
const streamed = async (response: Response, deadline: Promise<void>, maxBytes: number) => {
  const strip = flightStripper()
  if (!response.body) return { html: '', complete: true, swapped: strip.swapped() }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const late = deadline.then(() => undefined)
  let html = ''
  let raw = 0
  const done = (complete: boolean) => {
    html += strip.write(decoder.decode()) + strip.end()
    return { html, complete, swapped: strip.swapped() }
  }
  try {
    for (;;) {
      const chunk = await Promise.race([reader.read(), late])
      if (!chunk) break
      if (chunk.done) return done(true)
      raw += chunk.value.byteLength
      html += strip.write(decoder.decode(chunk.value, { stream: true }))
      if (html.length > maxBytes || raw > maxBytes * RAW) {
        void reader.cancel().catch(() => {})
        // the html kept says it first: that's what raising maxBytes is for
        return { whole: html.length <= maxBytes }
      }
    }
  } catch {
    // the fetch was aborted at the deadline mid-read
  }
  void reader.cancel().catch(() => {})
  return done(false)
}

const extraHeaders = async (request: Request, headers: MdHandlerOptions['headers']) =>
  new Headers(typeof headers === 'function' ? await headers(request) : headers)

// why an answer of the route's own isn't public, on every one that isn't
export type Uncached =
  | 'credentials'
  | 'set-cookie'
  | 'gate'
  | 'status'
  | 'partial'
  | 'error'
  | 'negotiated'
  | 'invalid'
  | 'private'
export const UNCACHED_HEADER = 'x-affordances-md-uncached'
// how an answer of the route's own is cached: public only with a grant (the route's publicCache, or the page's own
// cache-control), private, no-store otherwise. personal marks one llms leaves out
type Caching = { grant?: string; why?: Uncached; personal?: boolean }

// the one place an answer's cache headers are written, so one without a grant is private by construction. it varies
// on Accept, as well as on whatever it already varies on
const cached = (headers: Headers, { grant, why, personal }: Caching) => {
  headers.set('cache-control', grant ?? 'private, no-store')
  if (!grant) headers.set(UNCACHED_HEADER, why ?? 'status')
  if (personal) headers.set(PERSONAL_HEADER, '1')
  const vary = headers.get('vary')
  if (!vary) headers.set('vary', 'Accept')
  else if (!/(^|,)\s*accept\s*(,|$)/i.test(vary)) headers.set('vary', `${vary}, Accept`)
  return headers
}

// markdown of the route's own, or a redirect when there's no body
const respond = (
  body: string | null,
  status: number,
  cache: Caching,
  headers: Record<string, string> = {},
) =>
  new Response(body, {
    status,
    headers: cached(
      new Headers(
        body === null ? headers : { 'content-type': 'text/markdown; charset=utf-8', ...headers },
      ),
      cache,
    ),
  })

// a request (or the headers option) that carries someone's credentials, whose response is theirs alone
const CREDENTIALS = ['cookie', 'authorization']
const credentialed = (headers: Headers) => CREDENTIALS.some((name) => headers.has(name))

// the headers a page's own response depends on, which a passthrough forwards: the caller's credentials and
// language, content negotiation, conditional requests, and next's flight headers for a client navigation (as of
// next 16.4's app-router-headers). nothing else the caller sent, so no internal or forwarding header reaches the page
const AS_IS = [
  ...FORWARD,
  'accept',
  'user-agent',
  'if-none-match',
  'if-modified-since',
  'rsc',
  'next-router-state-tree',
  'next-router-prefetch',
  'next-router-segment-prefetch',
  'next-url',
  'next-hmr-refresh',
]

// a request for the page itself rather than its markdown, as the handler fetches it: the caller's own headers from
// AS_IS, then the headers option's (never its credentials: this is the person's page, not a render of ours), and
// ours, so the rewrites leave the fetch alone
const asIs = async (request: Request, options: MdHandlerOptions) => {
  const headers = new Headers()
  for (const name of AS_IS) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }
  for (const [name, value] of await extraHeaders(request, options.headers))
    if (!CREDENTIALS.includes(name)) headers.set(name, value)
  headers.set(RENDER_HEADER, '1')
  return headers
}

// how long a page may take to render, by default
const TIMEOUT = 10_000
const MIB = 1024 * 1024

// the page's headers, for a response of ours that passes it on. fetch has already decoded the body, so its encoding
// and length no longer describe it, and next's x-middleware-* (set when a proxy.ts rewrote the page) make it throw
// on a route handler's response
const passedHeaders = (upstream: Response) => {
  const headers = new Headers(upstream.headers)
  const internal = [...upstream.headers.keys()].filter((name) => name.startsWith('x-middleware-'))
  for (const name of ['content-encoding', 'content-length', ...internal]) headers.delete(name)
  return headers
}

// the answer when the page's fetch didn't come back: a 504 when its time ran out, a 502 when it failed outright (refused,
// unreachable). the origin can be an internal host (AFFORDANCES_MD_ORIGIN), so only development says it, and why
const unreached = (target: URL, timedOut: boolean, timeout: number, error?: unknown) => {
  if (timedOut) return fail(504, `${target.pathname} took longer than ${timeout}ms to render`)
  const dev = process.env.NODE_ENV !== 'production'
  const cause = dev ? ` (${target.origin}: ${String(error)})` : ''
  if (dev)
    console.warn(
      `[affordances-md] couldn't reach ${target.href} to convert it${cause}. Check AFFORDANCES_MD_ORIGIN or the handler's origin option.`,
    )
  return fail(502, `Couldn't reach the page to convert it\n\n${target.pathname}${cause}`)
}

// the page's response as it came: status, headers (set-cookie and vary too) and body; unreached's answer when its
// headers didn't arrive by the timeout, or the fetch failed. the body then streams on, never cut short
const passPage = async (request: Request, target: URL, options: MdHandlerOptions) => {
  const controller = new AbortController()
  const timeout = options.timeout ?? TIMEOUT
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const upstream = await fetch(target, {
      headers: await asIs(request, options),
      redirect: 'manual',
      signal: controller.signal,
    })
    const headers = passedHeaders(upstream)
    // the caller's credentials make it theirs alone. the headers option's are never sent here (asIs), so a cookie
    // set in answer is the caller's own, and goes out as the page sent it
    if (credentialed(request.headers)) headers.set('cache-control', 'private, no-store')
    return new Response(upstream.body, { status: upstream.status, headers })
  } catch (error) {
    return unreached(target, controller.signal.aborted, timeout, error)
  } finally {
    clearTimeout(timer)
  }
}

// a redirect as next gives it, from wherever it came: the page's own 3xx, the refresh meta it streams for a redirect()
// after the shell (readPage's redirect), or the digest of a redirect() thrown in markdown.ts
type NextRedirect = { status: number; location: string | null }
// every redirect a markdown request gets: to the target's twin when it has one (twinLocation: a page on this site,
// with its /. guard), otherwise as it is, never followed
const markdownRedirect = ({ status, location }: NextRedirect, target: URL, cache: Caching) => {
  const to = (location && twinLocation(new URL(location, target), target)) ?? location
  return respond(null, status, cache, to ? { location: to } : {})
}

// a 307 from a page's own url to its twin, with a line naming it for an agent that doesn't follow redirects
// relative, as every markdown redirect is: request.url's host is next's own (localhost behind a proxy), never the
// public one. undefined for a url with no twin
const toTwin = (url: URL) => {
  const twin = twinLocation(url, url)
  if (!twin) return undefined
  return respond(`This page's Markdown is at [${twin}](${twin}).\n`, 307, {}, { location: twin })
}

// a page's own 404 (a notFound() in it, streamed or not, or in its markdown.ts or a fill) in its markdown.ts's
// notFoundMarkdown, when it has one and gives something: always 404, never cached. a Response the default export
// returned itself is its own answer
const notFoundPage = async (response: Response, { module, args }: MarkdownRoute, target: URL) => {
  if (response.status !== 404 || !module.notFoundMarkdown || authoredResponses.has(response))
    return response
  const result = await module.notFoundMarkdown(args)
  if (result === undefined) return response
  const body = authoredBody(result, target)
  return respond(
    body,
    404,
    { personal: response.headers.has(PERSONAL_HEADER) },
    { 'x-affordances-tokens': String(Math.ceil(body.length / 4)) },
  )
}
// markdown a route's markdown.ts gave (its default export or notFoundMarkdown), with the frontmatter a converted page
// gets, and append's after it
const authoredBody = (result: string | Authored, target: URL, extra?: string) => {
  const given = typeof result === 'string' ? { markdown: result } : result
  const meta = {
    title: given.title ?? headingOf(given.markdown)?.text,
    description: given.description,
    url: target.href,
  }
  const page = `${yaml(meta)}${given.markdown.trim()}\n`
  return extra ? `${page}\n${extra.trim()}\n` : page
}
// the Responses a default export returned itself, which no other answer replaces
const authoredResponses = new WeakSet<Response>()

// an answer of the handler's own, never cached; personal when it was made with someone's credentials
const fail = (status: number, message: string, personal = false) =>
  respond(`# ${message}\n`, status, { personal })

// a path on the site's own origin as a url, or undefined: new URL reads one that starts with //host as another
// origin, and the caller's credentials (or the headers option) never go there
const pageUrl = (request: Request, options: MdHandlerOptions, path: string) => {
  const base = new URL(origin(request, options))
  const url = new URL(path, base)
  return url.origin === base.origin ? url : undefined
}

type Seen = {
  // on a route opted into publicCache, what kept it private before anything rendered: said instead of 'private'
  why?: Uncached
  routed?: MarkdownRoute
  target?: URL
  // a gate's rewrite mdProxy adopted: the page it chose, never sent on to the twin of the url asked for
  adopted?: boolean
}

const convertPage = (options: MdHandlerOptions) => {
  const render = renderPage(options)
  return async (
    request: Request,
    pagePath: string,
    direct: boolean,
    adopted = false,
  ): Promise<Response> => {
    const seen: Seen = { adopted }
    const rendered = await render(request, pagePath, direct, seen)
    const response = seen.routed
      ? await notFoundPage(rendered, seen.routed, seen.target!)
      : rendered
    // the reason an opted-in route met first says more than 'private' does, in production too, where a gate setting a
    // cookie for a signed-out visitor is otherwise silent
    if (seen.why && response.headers.get(UNCACHED_HEADER) === 'private')
      response.headers.set(UNCACHED_HEADER, seen.why)
    return response
  }
}

const renderPage =
  (options: MdHandlerOptions) =>
  async (request: Request, pagePath: string, direct: boolean, seen: Seen): Promise<Response> => {
    const { timeout = TIMEOUT, maxBytes = 16 * MIB, append } = options
    if (request.headers.has(RENDER_HEADER)) return fail(508, 'Loop detected')

    const url = new URL(request.url)
    const target = pageUrl(request, options, pagePath + url.search)
    if (!target) return fail(400, 'Not a page on this site')
    // markdown served at a url that also serves the page's html: /x asked for with Accept, or a literalMd page whose
    // own url ends in .md. a cache that ignores Vary (Cloudflare's Cache Everything) would serve one for the other, so
    // none of it is ever public, on any branch. the .md twin url is its own; a direct hit is the handler's own url
    const negotiated =
      !handlerPrefix.test(url.pathname) &&
      (!/\.md$/i.test(url.pathname) || pagePath === url.pathname)
    // a client navigation reaches here when a proxy.ts rewrote it (next hides its RSC header from the proxy, then
    // puts it back): it wants the page's RSC payload, so it gets that, never markdown
    if (request.headers.get('rsc')) return passPage(request, target, options)
    // a route handler next routes the url to (/llms.txt, or /og/[slug] where no static page beats it), asked for with
    // Accept: its own response, as it is, with the caller's own headers, never a render of ours
    if (pageRoute(target.pathname, { strict: true })?.handler)
      return passPage(request, target, options)
    // the route's own markdown.ts, when it has one and gives something, instead of rendering the page
    // only for a request that came in at the page's own url (/x.md, or /x with Accept), the url proxy.ts gated. one
    // made straight to the handler's url (/api/affordances/md/x) skipped a page-scoped gate, so it gets the html render,
    // which goes through the proxy at the page's url
    const route = direct ? undefined : await markdownRoute(request, target)
    // whose request this is: the caller's own credentials, or none, so the headers option's may stand in
    const callerCredentials = credentialed(request.headers)
    // an anonymous agent asking for the page's own url with Accept, on a route whose markdown is public: sent to the
    // twin, the url a cdn can keep, with nothing rendered. never stored itself, so it's safe on a cdn that ignores Vary
    if (
      !seen.adopted &&
      negotiated &&
      !/\.md$/i.test(url.pathname) &&
      route?.module.publicCache !== undefined &&
      !callerCredentials
    ) {
      const twin = toTwin(url)
      if (twin) return twin
    }
    // a response that may be public is one view for everyone, which a CDN keys on its url alone: all of it (the
    // headers option, the render, markdown.ts and its fills, append) sees one request, with no visitor's headers. a
    // credentialed or negotiated request, which stays private, is the visitor's own
    const shareable = route?.module.publicCache !== undefined && !negotiated && !callerCredentials
    const view = shareable ? viewRequest(request) : request
    // the headers option, resolved once: one answer (from an option that mints a token, say) for whether the response
    // can be public and for the render. a route that opts in is never public while it gives service credentials, even
    // where they go unused, so the rule is the same whichever way the route answers
    const early = shareable ? await extraHeaders(view, options.headers) : undefined
    const oneView = shareable && !credentialed(early!)
    const opted = route?.module.publicCache !== undefined
    if (opted && (callerCredentials || (shareable && !oneView))) seen.why = 'credentials'
    else if (opted && publicCacheControl(route!.module.publicCache).problem) seen.why = 'invalid'
    const asked = oneView ? view : request
    const routed = route && oneView ? { ...route, args: { ...route.args, request: asked } } : route
    seen.routed = routed
    seen.target = target
    const authored =
      routed && (await authoredMarkdown(asked, target, routed, append, negotiated, oneView))
    if (authored) return authored
    const headers = new Headers()
    for (const name of FORWARD) {
      const value = asked.headers.get(name)
      if (value) headers.set(name, value)
    }
    // the headers option's cookie and authorization (a service account's) apply only to a request that sent neither:
    // a signed-in person's markdown is rendered as them alone, never as more than they could see. all or nothing,
    // since an app checking a bearer first would otherwise render a cookie-signed-in person as the service
    const given = early ?? (await extraHeaders(request, options.headers))
    for (const [name, value] of given)
      if (!callerCredentials || !CREDENTIALS.includes(name)) headers.set(name, value)
    headers.set('accept', 'text/html')
    // the page over the server's own loopback: compressing it for us costs the server more than the bytes it saves
    headers.set('accept-encoding', 'identity')
    headers.set(RENDER_HEADER, '1')
    // the service's credentials that stood in, whose refreshed cookie must never reach the caller
    const serviceCredentials = !callerCredentials && credentialed(given)

    // one deadline for the whole render: the fetch until its headers, then the streamed body
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        controller.abort()
        resolve()
      }, timeout)
    })
    const slow = () => fail(504, `${target.pathname} took longer than ${timeout}ms to render`)

    let upstream: Response
    try {
      upstream = await fetch(target, { headers, redirect: 'manual', signal: controller.signal })
    } catch (error) {
      clearTimeout(timer)
      return unreached(target, controller.signal.aborted, timeout, error)
    }

    // the page's own redirect, or one it streamed, is cached as the page would be
    const cacheControl = upstream.headers.get('cache-control') ?? ''
    const pageCache: Caching =
      negotiated ||
      callerCredentials ||
      serviceCredentials ||
      /private|no-store/.test(cacheControl) ||
      upstream.headers.has('set-cookie')
        ? {}
        : { grant: cacheControl || undefined }
    if (upstream.status >= 300 && upstream.status < 400) {
      clearTimeout(timer)
      const location = upstream.headers.get('location')
      return markdownRedirect({ status: upstream.status, location }, target, pageCache)
    }

    // anything else (a file in public/, json) is passed on as it came
    if (!upstream.headers.get('content-type')?.includes('text/html')) {
      // the deadline is for rendering a page; a file streams on to its end
      clearTimeout(timer)
      const passed = passedHeaders(upstream)
      // credentialed means private; a cookie set in answer to the headers option's credentials is the service's
      if (serviceCredentials) passed.delete('set-cookie')
      if (callerCredentials || serviceCredentials) passed.set('cache-control', 'private, no-store')
      return new Response(upstream.body, { status: upstream.status, headers: passed })
    }
    // a page past maxBytes, which a page that grows (a report, a changelog) can reach long after launch: the answer
    // and the server's log both say what to change
    // the html it keeps past maxBytes, or the whole response, flight data and all, past RAW times it
    const tooLarge = (whole: boolean) => {
      const size = (bytes: number) => (bytes % MIB ? `${bytes} bytes` : `${bytes / MIB} MiB`)
      const limit = whole
        ? `${size(maxBytes * RAW)} in all (${RAW} × maxBytes)`
        : `${size(maxBytes)} (maxBytes)`
      const named = whole ? limit : `maxBytes (${size(maxBytes)})`
      const fix = `To convert it, raise maxBytes in the md route (app/api/affordances/md/[[...path]]/route.ts): \`export const GET = createMdHandler({ maxBytes: ${Math.ceil((2 * maxBytes) / MIB)} * 1024 * 1024 })\`.`
      // in production too, where a page grows past it, once per page
      once(
        `maxBytes ${target.pathname}`,
        `[affordances-md] ${target.pathname} is larger than ${named}, so it answers 413. ${fix}`,
        { production: true },
      )
      return fail(
        413,
        `The page is too large to convert\n\nIts ${whole ? 'response' : 'HTML'} is larger than ${limit}. ${fix}`,
      )
    }
    if (Number(upstream.headers.get('content-length') ?? 0) > maxBytes * RAW) {
      clearTimeout(timer)
      return tooLarge(true)
    }
    const body = await streamed(upstream, deadline, maxBytes)
    clearTimeout(timer)
    if ('whole' in body) return tooLarge(body.whole === true)
    // a page whose shell arrived is converted as far as it streamed: boundaries still loading keep their fallback
    const partial = !body.complete
    if (partial && !body.html.trim()) return slow()
    // the page, read once: what it streamed, the slots it rendered, and its markdown
    let read: Page
    try {
      read = readStreamed(body.html, body.swapped, {
        url: target.href,
        link: options.linkTwins === false ? undefined : twinLinks(target),
      })
    } catch (error) {
      if (!(error instanceof FlightDataError)) throw error
      // flight data the stripper can't account for (a push it didn't take out, one it can't read, a placeholder that
      // isn't a script): what the page says can't be told, so none of it goes out. in production too, once
      once(
        'flight',
        `[affordances-md] ${target.pathname}'s Flight data couldn't be read (${error.reason}), so it answers 502, private, no-store. If it's a page of Next's own, update @affordances/md or report it.`,
        { production: true, level: 'error' },
      )
      return fail(
        502,
        "The page couldn't be read to convert it",
        credentialed(headers) || upstream.headers.has('set-cookie'),
      )
    }
    // personal: rendered with someone's credentials (the caller's, or the route's service ones), or answered with a
    // cookie. a credential-free render is the anonymous public view, whatever cache-control next put on it (next
    // sends private, no-store for every dynamic render), so only this marks a page for llms to leave out
    const personalOnly = credentialed(headers) || upstream.headers.has('set-cookie')
    // a redirect(), notFound(), forbidden() or unauthorized() after the shell went out, which next streams in as a 200,
    // before any slot is filled
    const control = streamedAnswer(read, target, pageCache, personalOnly)
    if (control) return control
    // a digest of next's this md can't read may be a redirect or an error status it can't tell: never a 200 of the shell
    const unknown = unknownDigest(read.errors)
    if (unknown)
      return fail(
        502,
        `The page answered in a way this version of @affordances/md can't read\n\nNext.js streamed ${unknown} into it.`,
        personalOnly,
      )
    const errored = read.errors.length > 0
    // append runs alongside the fills; a fill's notFound() may answer for the page first, so its rejection waits to be
    // awaited below rather than going unhandled
    const appended = Promise.resolve(append?.(asked))
    appended.catch(() => {})
    // the page rendered, so its own redirect(), notFound() and layout checks ran: now the slots it rendered get filled
    const slots = routed?.module.slots && (await fillSlots(read.slots, target, routed))
    if (slots instanceof Response) return slots
    const result = read.markdown(slots)
    const page = partial
      ? `${result.markdown}\n> Some of this page was still loading after ${timeout}ms and is missing or shown as its loading state.\n`
      : result.markdown
    const extra = await appended
    const markdown = extra ? `${page}\n${extra.trim()}\n` : page

    // anything rendered with the caller's credentials, or that the page itself keeps private, stays private
    // a fill read data with whatever the request carried, as markdown.ts's default export does: never cached
    const filled = slots !== undefined && Object.keys(slots).length > 0
    const personal = personalOnly || filled || /private|no-store/.test(cacheControl) || negotiated
    // a route whose markdown.ts says its markdown is public: the anonymous, complete view of its .md url, as a 200,
    // gets that cache time, whatever next sent (private, no-store for a dynamic render) and whatever the fills read
    if (shareable && upstream.headers.has('set-cookie') && !credentialed(headers)) {
      warnCookie(route!.route, target, upstream.headers)
      seen.why ??= 'set-cookie'
    }
    const varies = /(^|,)\s*accept-language\s*(,|$)/i.test(upstream.headers.get('vary') ?? '')
    if (shareable && varies) warnLanguage(route!.route)
    const shared =
      oneView && !personalOnly && !partial && !errored && upstream.status === 200
        ? publicHeader(route!.route, route!.module)
        : undefined
    // a partial page is never cached, so the next request gets the whole one
    const grant = shared ?? (personal || partial || errored ? undefined : cacheControl || undefined)
    return respond(
      markdown,
      upstream.status,
      {
        grant,
        why: credentialed(headers)
          ? 'credentials'
          : upstream.headers.has('set-cookie')
            ? 'set-cookie'
            : upstream.status !== 200
              ? 'status'
              : partial
                ? 'partial'
                : errored
                  ? 'error'
                  : negotiated
                    ? 'negotiated'
                    : 'private',
        personal: personalOnly,
      },
      {
        // a page that varies on the language the render was asked in varies the markdown too
        ...(varies && headers.has('accept-language') && { vary: 'Accept, Accept-Language' }),
        'x-affordances-tokens': String(Math.ceil(markdown.length / 4)),
        ...(result.url && { link: `<${result.url}>; rel="canonical"` }),
        ...(partial && { [PARTIAL_HEADER]: '1' }),
      },
    )
  }

// the markdown of the page a request is for. a .md path on a literalMd route is the page itself when that answers
// with anything but a 404 (converted for a markdown request, passed through for any other), and a twin when it 404s
export const createMdHandler = (options: MdHandlerOptions = {}) => {
  const convert = convertPage(options)
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    // a gate's rewrite: the page it chose, with its status, always private
    const adopted = adoptedBy(request)
    if (adopted === 'refused') {
      if (process.env.NODE_ENV !== 'production')
        console.error(
          `[affordances-md] ${new URL(request.url).pathname} came with an ${ADOPT_HEADER} that isn't this build's, so it answers 500. mdProxy sets it; a caller's own never counts.`,
        )
      return fail(500, "The page's gate couldn't be verified")
    }
    if (adopted) {
      // the page the gate chose, with its own query
      const asked = new URL(request.url)
      asked.search = adopted.search
      // the gate's own headers, never the token: markdown.ts, its fills, append and the headers option may log or
      // forward them, and the token is what keeps a caller from running any route's markdown.ts past its gate
      const sent = new Headers(request.headers)
      sent.delete(ADOPT_HEADER)
      const gated = new NextRequest(asked, {
        method: request.method,
        headers: sent,
        signal: request.signal,
      })
      const found = await convert(gated, adopted.page, false, true)
      // why it's private, unless it already was
      const why = (found.headers.get(UNCACHED_HEADER) as Uncached | null) ?? 'gate'
      const headers = cached(new Headers(found.headers), { why })
      const status = adopted.status === 200 ? found.status : adopted.status
      return new Response(found.body, { status, headers })
    }
    // a rewritten request keeps its original url in next (/blog/post.md, or /blog/post with Accept); one made straight
    // to the handler's url (/api/affordances/md/x) skipped a page-scoped proxy.ts gate, so it never gets a markdown.ts
    const direct = handlerPrefix.test(url.pathname)
    const asked = url.pathname.replace(handlerPrefix, '') || '/'
    if (isLiteral(asked) && !request.headers.has(RENDER_HEADER)) {
      const markdown = present(request, url, accepts[0]!) && !request.headers.get('rsc')
      const found = markdown
        ? await convert(request, asked, direct)
        : await literalPage(request, asked, options)
      if (found.status !== 404) return found
    }
    return convert(request, mdPagePath(url.pathname), direct)
  }
}

// the literal page as it came, for a request that isn't for markdown: the person asked for a page named x.md
const literalPage = async (request: Request, page: string, options: MdHandlerOptions) => {
  const target = pageUrl(request, options, page + new URL(request.url).search)
  if (!target) return fail(400, 'Not a page on this site')
  const passed = await passPage(request, target, options)
  if (passed.status === 404) void passed.body?.cancel().catch(() => {})
  // its Link, which md()'s rules leave off a url ending in .md, since there it would be a twin's too
  else if (passed.ok && passed.headers.get('content-type')?.includes('text/html'))
    passed.headers.append('link', `<${mdPath(page)}>; ${LINK}`)
  return passed
}

// a route's params from its folder names, as next gives them to page.tsx: [x] is a string, [...x] a string[], and
// [[...x]] a string[] or left out. '/blog/[slug]' → { slug: string }; any string → every param a string or string[]
export type SegmentParams<Segment extends string> = Segment extends `[[...${infer Name}]]`
  ? { [K in Name]?: string[] }
  : Segment extends `[...${infer Name}]`
    ? { [K in Name]: string[] }
    : Segment extends `[${infer Name}]`
      ? { [K in Name]: string }
      : Record<never, never>
// one branch: a leading / is an empty first segment, which has no params
export type PathParams<Path extends string> = Path extends `${infer Segment}/${infer Rest}`
  ? SegmentParams<Segment> & PathParams<Rest>
  : SegmentParams<Path>
export type RouteParams<Route extends string> = string extends Route
  ? Record<string, string | string[]>
  : { [K in keyof PathParams<Route>]: PathParams<Route>[K] }

// app/**/markdown.ts, next to page.tsx: the page's markdown from its data, without rendering it. name the route for
// typed params, as page.tsx's PageProps does: MarkdownArgs<'/blog/[slug]'>
export type MarkdownArgs<Route extends string = string> = {
  // the app/ route the request matched, as md() found it ('/package/[pkg]'); the handler always passes it. typed as the
  // route string, so a markdown.ts typed for another route (a typo, a copy from a sibling) fails tsc in the generated
  // .affordances/md.ts. optional, so arguments built by hand, as 0.2.0's were, still type-check
  route?: Route
  // still url-encoded, exactly as page.tsx gets them: { pkg: '%40babel%2Fcore' }
  params: RouteParams<Route>
  searchParams: URLSearchParams
  request: Request
}
export type MarkdownResult =
  | string
  | { markdown: string; title?: string; description?: string }
  | Response
  | undefined
// markdown with what its frontmatter says: its title (by default its first heading) and description
type Authored = Extract<MarkdownResult, { markdown: string }>
export type Markdown<Route extends string = string> = (
  args: MarkdownArgs<Route>,
) => MarkdownResult | Promise<MarkdownResult>
// markdown.ts's slots export: each <AgentSlot name> the page renders, filled with markdown. undefined leaves the
// slot's own content, converted as usual
export type SlotResult = string | undefined
export type Slots<Route extends string = string> = Record<
  string,
  (args: MarkdownArgs<Route>) => SlotResult | Promise<SlotResult>
>
// a markdown.ts, as the generated .affordances/md.ts checks it against its route: called with the route itself, so
// an export typed for any other route string doesn't fit
export type RouteArgs<Route extends string> = MarkdownArgs<Route> & { route: Route }
// the generated check passes the app's own cacheLife profiles as Cache, so a custom name is typed and a typo isn't
export type MarkdownModule<Route extends string = string, Cache = PublicCache> = {
  default?: (args: RouteArgs<Route>) => MarkdownResult | Promise<MarkdownResult>
  slots?: Record<string, (args: RouteArgs<Route>) => SlotResult | Promise<SlotResult>>
  publicCache?: Cache
  notFoundMarkdown?: (args: RouteArgs<Route>) => NotFoundResult | Promise<NotFoundResult>
}
// markdown.ts's notFoundMarkdown: the markdown of the route's 404, when its page called notFound(). undefined keeps the
// page's own: its not-found.tsx converted, or a fixed body when next streamed the 404 after the shell
export type NotFoundResult = Exclude<MarkdownResult, Response>
export type NotFoundMarkdown<Route extends string = string> = (
  args: MarkdownArgs<Route>,
) => NotFoundResult | Promise<NotFoundResult>
// next's own cacheLife profiles; next.config's cacheLife adds yours
export type CacheLifeProfile =
  | 'default'
  | 'seconds'
  | 'minutes'
  | 'hours'
  | 'days'
  | 'weeks'
  | 'max'
// markdown.ts's publicCache: how long a CDN may keep this route's public markdown, as next's cacheLife() takes it. a
// profile's name, or seconds: { revalidate: 300, expire: 86_400 }. it applies only to the anonymous view of a .md url
export type PublicCache<Profile extends string = CacheLifeProfile> =
  | Profile
  | { revalidate: number; expire?: number }
// what the generated .affordances/md.ts exports: each route's markdown.ts, loaded when it's first asked for. each
// entry is checked against its own route there, so this is as loose as any of them
export type MarkdownRoutes = Record<
  string,
  () => Promise<{
    default?: (args: never) => unknown
    slots?: Record<string, (args: never) => unknown>
    publicCache?: unknown
    notFoundMarkdown?: (args: never) => unknown
  }>
>

// markdown.ts's slots for the page as it rendered: only the names it rendered once run, together, each in the
// visitor's request as the default export does. a next error in any (notFound(), redirect()) answers for the whole
// page. in development it says what doesn't line up, naming the route's markdown.ts
const fillSlots = async (
  { unique, duplicate }: SlotNames,
  target: URL,
  { route, module, args }: MarkdownRoute,
): Promise<Record<string, string> | Response> => {
  const slots = module.slots!
  const warn = (message: string) =>
    once(
      `slots ${route} ${message}`,
      `[affordances-md] ${route}/markdown.ts, ${target.pathname}: ${message}`,
    )
  for (const name of duplicate)
    warn(
      `<AgentSlot name="${name}"> is on the page more than once, so no copy is filled and each converts as usual. Give each slot its own name.`,
    )
  for (const name of Object.keys(slots))
    if (!unique.includes(name) && !duplicate.includes(name))
      warn(`slots.${name} has no <AgentSlot name="${name}"> on the page, so it didn't run.`)
  try {
    const filled = await Promise.all(
      unique.map(async (name) => {
        // a name comes from the page's html: only the fills markdown.ts itself has, never one off Object.prototype
        const fill = Object.hasOwn(slots, name) ? slots[name] : undefined
        if (!fill)
          return warn(
            `<AgentSlot name="${name}"> has no slots.${name}, so its own content is converted.`,
          )
        const markdown = await fill(args)
        if (typeof markdown !== 'string')
          return warn(`slots.${name} returned nothing, so the slot's own content is converted.`)
        return [name, markdown] as const
      }),
    )
    return Object.fromEntries(filled.filter((entry) => entry !== undefined))
  } catch (error) {
    const thrown = thrownAnswer(error, target, credentialed(args.request.headers))
    if (thrown) return thrown
    throw error
  }
}

// next's notFound(), forbidden(), unauthorized(), redirect() and permanentRedirect() thrown in a markdown.ts, as
// the response they'd give the page: 404, 403 or 401, or a redirect, to the target's .md on this site and as it is
// to another origin. read off the error's digest (as of next 16.3 and 16.4's http-access-fallback and redirect-error);
// undefined for any other error, which goes on as it was. it's this request's answer, so it's never cached
const HTTP_ERRORS: Record<string, string> = {
  404: 'Not found',
  403: 'Forbidden',
  401: 'Unauthorized',
}
const thrownAnswer = (error: unknown, target: URL, personal: boolean) => {
  const digest =
    typeof error === 'object' && error !== null && 'digest' in error ? error.digest : undefined
  const thrown = typeof digest === 'string' ? fromDigest(digest) : undefined
  if (!thrown) return undefined
  if ('location' in thrown) return markdownRedirect(thrown, target, { personal })
  return fail(thrown.status, HTTP_ERRORS[thrown.status]!, personal)
}
// the same, streamed after the shell as a flight error row: readPage's redirect or fallback
const streamedAnswer = (page: Page, target: URL, cache: Caching, personal: boolean) => {
  if (page.redirect) return markdownRedirect(page.redirect, target, cache)
  if (page.fallback) return fail(page.fallback.status, HTTP_ERRORS[page.fallback.status]!, personal)
  return undefined
}

// the kind of a digest of next's (NEXT_…) that fromDigest can't read, from a next newer than this md, or undefined.
// only its kind, since the rest can hold a url. said once per process, in production too, since that's where a new
// next first runs
const unknownDigest = (digests: string[]) => {
  const unknown = digests.find((digest) => digest.startsWith('NEXT_') && !fromDigest(digest))
  if (!unknown) return undefined
  const kind = unknown.split(';')[0]!
  once(
    'digest',
    `[affordances-md] a page streamed a Next.js digest @affordances/md doesn't know (${kind}), so its markdown answers 502, private, no-store. Update @affordances/md, or report it if you're on the latest.`,
    { production: true, level: 'error' },
  )
  return kind
}

// the Cache-Control a route's publicCache gives, or undefined when it has none or it isn't one, which development
// says once per route: its markdown then stays as it would be without it
const publicHeader = (route: string, module: MarkdownModule) => {
  if (module.publicCache === undefined) return undefined
  const { header, problem } = publicCacheControl(module.publicCache)
  if (problem)
    once(
      `publicCache ${route}`,
      `[affordances-md] ${route}/markdown.ts: publicCache ${problem}; until then, it isn't cached.`,
      { level: 'error' },
    )
  return header
}

// a page that sets a cookie for an anonymous visitor (a session, an auth handshake) is never cached publicly: said in
// development, since its route asked to be
const warnCookie = (route: string, target: URL, headers: Headers) => {
  const names = headers.getSetCookie().map((cookie) => cookie.split('=')[0]!.trim())
  once(
    `cookie ${route} ${names.join(',')}`,
    `[affordances-md] ${target.pathname} set ${names.length === 1 ? 'a cookie' : 'cookies'} (${names.join(', ')}) for an anonymous visitor, so ${route}/markdown.ts's publicCache doesn't apply: its markdown is private, no-store. Don't set ${names.length === 1 ? 'it' : 'them'} on this page for a visitor who isn't signed in.`,
  )
}

// an opted-in route whose page varies on the visitor's language: its public markdown is rendered without one, so
// it's the default language. said once per route, in development
const warnLanguage = (route: string) =>
  once(
    `language ${route}`,
    `[affordances-md] ${route}'s page varies on Accept-Language, but ${route}/markdown.ts's publicCache makes its markdown one view for everyone: it's rendered without the visitor's language, so it's the default language. For Markdown in each language, put the locale in the path (/fr/…).`,
  )

// the route's markdown.ts for a page url, and the arguments its exports get; undefined when it has none
type MarkdownRoute = { route: string; module: MarkdownModule; args: RouteArgs<string> }
const markdownRoute = async (request: Request, target: URL): Promise<MarkdownRoute | undefined> => {
  const { routes } = await import('@affordances/md/routes')
  if (!routes) return undefined
  // the page next would render for this url, among all of md()'s pages: a static page without a markdown.ts isn't
  // taken over by a sibling [param] that has one. a public url an alias maps onto a route is matched as that route's
  // url, so its params are what page.tsx gets: /package/@babel/core → { pkg: '%40babel%2Fcore' }
  const found = pageRoute(target.pathname, { strict: true, routes: Object.keys(routes) })
  if (!found || !(found.route in routes)) return undefined
  return {
    route: found.route,
    // each entry was checked against its own route in the generated file
    module: (await routes[found.route]!()) as MarkdownModule,
    args: {
      route: found.route,
      params: found.params,
      searchParams: new URLSearchParams(target.search),
      request,
    },
  }
}

// what a route's markdown.ts gives, as the handler's response: its markdown with the frontmatter, append and token
// count a converted page gets, or its own Response. private whenever the request carried credentials, since it read
// data as that person. undefined when it has no default export, or that returned nothing
const authoredMarkdown = async (
  request: Request,
  target: URL,
  { route, module, args }: MarkdownRoute,
  append: MdHandlerOptions['append'],
  negotiated: boolean,
  // whether the answer may be public: the route opted in, and the request is the one view
  oneView: boolean,
): Promise<Response | undefined> => {
  const markdown = module.default
  // a markdown.ts with only slots converts the page, which fills them
  if (!markdown) return undefined
  const personal = credentialed(request.headers)
  let result: MarkdownResult
  try {
    result = await markdown(args)
  } catch (error) {
    const thrown = thrownAnswer(error, target, personal)
    if (thrown) return thrown
    throw error
  }
  if (result instanceof Response) {
    const passed = new Response(result.body, {
      status: result.status,
      statusText: result.statusText,
      headers: result.headers,
    })
    // the author's own caching holds, but only when they set one, only at the .md url (at the page's own url,
    // negotiated, that url serves the html too), and never for a credentialed request
    const own = passed.headers.get('cache-control') ?? ''
    cached(passed.headers, {
      grant: personal || negotiated || !own ? undefined : own,
      why: personal ? 'credentials' : negotiated ? 'negotiated' : 'private',
      personal: personal || /private|no-store/.test(own),
    })
    authoredResponses.add(passed)
    return passed
  }
  if (result === undefined) {
    // with slots, undefined is how a default export hands the page back to be converted and filled: no mistake to warn of
    if (!module.slots)
      once(
        `nothing ${route}`,
        `[affordances-md] ${route}/markdown.ts returned nothing for ${target.pathname}, so its HTML is converted`,
      )
    return undefined
  }
  const body = authoredBody(result, target, await append?.(request))
  return respond(
    body,
    200,
    {
      // it read data with whatever the request carried, which the handler can't tell a credential from (an x-api-key):
      // never cached, unless its markdown.ts says the route's markdown is public, and then only an anonymous .md
      grant: (oneView && publicHeader(route, module)) || undefined,
      why: personal ? 'credentials' : negotiated ? 'negotiated' : 'private',
      personal,
    },
    {
      'x-affordances-tokens': String(Math.ceil(body.length / 4)),
      link: `<${target.href}>; rel="canonical"`,
    },
  )
}

// app/api/affordances/md/[[...path]]/route.ts: export { GET } from '@affordances/md/next'
export const GET = /* @__PURE__ */ createMdHandler()

// llms.txt and llms-full.txt. both list the pages md() found in app/ and the routes of the site's own Affordances
// index when it serves one, which also gives the site's name and each route's description

// the protocol's well-known path; @affordances/md works without the rest of Affordances, so it's spelled out
const SITE_INDEX = '/.well-known/affordances.json'

type SiteIndex = { name?: string; routes: { route: string; description?: string }[] }

const ADOPT_ENV = 'AFFORDANCES_MD_ADOPT'
// a gate's rewrite or status that mdProxy adopted: the page and status on ADOPT_HEADER, taken only with this build's
// token, so a caller who sends the header gets nothing. status 200 keeps the page's own
const adoptedBy = (request: Request) => {
  const said = request.headers.get(ADOPT_HEADER)
  if (said === null) return undefined
  // spelled out: next inlines process.env.NAME, never process.env[name]
  const token = process.env.AFFORDANCES_MD_ADOPT
  const [given, status] = said.split(';', 2)
  const at = said.indexOf(';', said.indexOf(';') + 1)
  const page = at < 0 ? '' : said.slice(at + 1)
  // a header that isn't this build's is refused, never taken for no gate at all: the gate's answer is never bypassed
  if (!token || given !== token || !page.startsWith('/') || page.startsWith('//')) return 'refused'
  const code = Number(status)
  const target = new URL(page, 'http://page')
  return {
    page: target.pathname,
    search: target.search,
    status: code >= 200 && code < 600 ? code : 200,
  }
}

const siteIndex = async (
  request: Request,
  options: MdHandlerOptions,
): Promise<SiteIndex | undefined> => {
  // an app md() describes serves an index only when withAffordances says so (AFFORDANCES_INDEX), whichever wrapper
  // ran first; otherwise /.well-known/affordances.json is never asked for. spelled out: next inlines process.env.NAME,
  // never process.env[name]
  if (process.env.AFFORDANCES_MD_ROUTES !== undefined && !process.env.AFFORDANCES_INDEX)
    return undefined
  try {
    const headers = await extraHeaders(request, options.headers)
    headers.set('accept', 'application/json')
    // never followed: a redirect (to an sso host, say) would take the headers option's secrets with it. a 3xx is no index
    const response = await fetch(new URL(SITE_INDEX, origin(request, options)), {
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(options.timeout ?? TIMEOUT),
    })
    if (!response.ok) void response.body?.cancel().catch(() => {})
    const body = response.ok ? ((await response.json()) as Partial<SiteIndex>) : undefined
    return Array.isArray(body?.routes) ? (body as SiteIndex) : undefined
  } catch {
    return undefined
  }
}

// the site index's routes and the pages md() found in app/, without a dynamic segment: those are pages as they
// stand, while /products/[slug] needs the app to name its pages
const staticRoutes = (index?: SiteIndex) =>
  [...new Set([...(index?.routes.map((r) => r.route) ?? []), ...builtPages()])].filter(
    (route) => !route.includes('['),
  )

// the public markdown of each page: its own url asked for with Accept: text/markdown, as an anonymous agent would,
// through the rewrites and proxy.ts, so each page renders in a request of its own. not its twin: on a literalMd route
// /x/notes.md may be a page of its own, and the Accept form is never ambiguous. in this one, a markdown.ts reading cookies() from
// next/headers would get the caller's, and its markdown would end up in a file cached for everyone. only the headers
// option goes along (never our own render header, which the route answers with a 508). a page the proxy turns away
// (a redirect to log in) is left out, not followed
const renderPages = async (
  request: Request,
  paths: string[],
  options: LlmsFetchOptions & { headers: Headers },
): Promise<Rendered[]> => {
  const timeout = options.timeout ?? TIMEOUT
  // one deadline for the whole file, under a serverless host's limit: a page not rendered by then failed
  const deadline = options.deadline ?? DEADLINE
  const overall = new AbortController()
  const timer = setTimeout(() => overall.abort(), deadline)
  const late = `not rendered within the file's ${deadline}ms deadline`
  const render = async (path: string): Promise<Rendered> => {
    if (overall.signal.aborted) return { path, failed: late }
    // a path from the site index, pages() or sections() that starts with //host or names another origin is never
    // fetched: the headers option (a bearer token, a bypass secret) stays on this site
    const target = pageUrl(request, options, path)
    if (!target) return { path, left: 'not on this site' }
    try {
      const headers = new Headers(options.headers)
      headers.set('accept', 'text/markdown')
      // each page's own timeout, from when its fetch starts, not from when the file was asked for
      const signal = AbortSignal.any([AbortSignal.timeout(timeout), overall.signal])
      // the page's twin, the url its markdown is cached at; on a literalMd route /x/notes.md may be a page of its own,
      // so there the page's own url asked for with Accept, which is never ambiguous
      const at = new URL(target)
      const twin = mdPath(target.pathname)
      if (!isLiteral(target.pathname) && !isLiteral(twin)) at.pathname = twin
      const response = await fetch(at, { headers, redirect: 'manual', signal })
      // a body never read is let go, so no connection is held for it
      const left = (why: string, failed = false) => {
        void response.body?.cancel().catch(() => {})
        return failed ? { path, failed: why } : { path, left: why }
      }
      // a server error, or one that asks to be retried, may answer next time: the page failed. any other status (a
      // redirect, a 404, a gate's 401) is the page's answer, and it isn't a page of the public site
      const { status } = response
      if (status >= 500 || status === 408 || status === 429) return left(`answered ${status}`, true)
      if (!response.ok) return left(`answered ${status}`)
      const type = response.headers.get('content-type') ?? 'no content-type'
      if (!type.startsWith('text/markdown')) return left(`answered ${type}, not markdown`)
      // a page its markdown route rendered privately (with credentials of the route's own, a private page, a
      // cookie set in answer) isn't the public view: left out, so the files stay public. negotiated markdown is
      // private too, but only because of where it was served, so it counts
      if (response.headers.has(PERSONAL_HEADER) || response.headers.has('set-cookie'))
        return { ...left('rendered with credentials, or it set a cookie'), private: true }
      // a boundary on it caught an error: the page's own, which a retry won't change, so it's left out of the public
      // files as a private page is, and they stay cacheable
      if (response.headers.get(UNCACHED_HEADER) === 'error')
        return left('a boundary on it caught an error')
      const markdown = await response.text()
      // converted as far as it streamed: its title still names it, but it isn't the whole page
      if (response.headers.has(PARTIAL_HEADER))
        return { path, markdown, failed: `still loading after ${timeout}ms` }
      return { path, markdown }
    } catch (error) {
      if (overall.signal.aborted) return { path, failed: late }
      const timedOut = error instanceof Error && error.name === 'TimeoutError'
      return {
        path,
        failed: timedOut ? `took longer than ${timeout}ms` : `failed: ${String(error)}`,
      }
    }
  }
  // a few at a time: each is a full render on the same server, and all at once is a burst that slows each one
  // past its timeout
  const rendered: Rendered[] = Array.from({ length: paths.length })
  let next = 0
  const worker = async () => {
    while (next < paths.length) {
      const i = next++
      rendered[i] = await render(paths[i]!)
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(options.concurrency ?? CONCURRENCY, paths.length) }, worker),
  )
  clearTimeout(timer)
  return rendered
}
// a page llms rendered, one that failed (and may render next time), or one left out because it isn't a page of the
// public site, each with why
type Rendered = {
  path: string
  markdown?: string
  failed?: string
  left?: string
  private?: boolean
}
const CONCURRENCY = 8
// under netlify's 26s for a synchronous function and vercel's limits; a host that allows more takes a longer one
const DEADLINE = 25_000

// in development, each page llms couldn't render or left out, and why: an error for a private one, which an app
// usually means to be public. the count of those that failed, which the file's header carries everywhere, never a
// list, since the file is public and could name a private page
const dropped = (file: string, pages: Rendered[]) => {
  const failed = pages.filter((page) => page.failed)
  if (process.env.NODE_ENV !== 'production') {
    const list = (some: Rendered[], why: 'failed' | 'left') =>
      `${some.length} ${some.length === 1 ? 'page' : 'pages'}: ${some.map((page) => `${page.path} (${page[why]})`).join(', ')}`
    if (failed.length)
      console.warn(`[affordances-md] ${file} couldn't render ${list(failed, 'failed')}`)
    const left = pages.filter((page) => page.left && !page.private)
    if (left.length) console.warn(`[affordances-md] ${file} left out ${list(left, 'left')}`)
    for (const { path, left: why } of pages.filter((page) => page.private))
      console.error(
        `[affordances-md] ${file} left out ${path}: its markdown is private, since it was ${why}. The llms files are public, so a page is in them only when it renders without credentials and sets no cookie, the view publicCache in its markdown.ts makes public.`,
      )
  }
  return failed.length
}
const DROPPED_HEADER = 'x-affordances-md-dropped'
// how long a client waits before asking again for a file that couldn't render every page
const RETRY_AFTER = 30

// a page's own words written into an llms file as plain text: one line, whitespace collapsed (U+2028 and U+2029 too),
// and what link, autolink and html syntax reacts to escaped, so a title can't add a link or a heading of its own
const plain = (text: string) =>
  text
    .replace(/[\s\u2028\u2029]+/g, ' ')
    .trim()
    .replace(/[\\[\]<>]/g, '\\$&')

// a page's markdown as the converter writes it: its frontmatter's title and description (JSON-quoted values), and
// the markdown after it, read once
type PageText = { title?: string; description?: string; body: string }
const frontmatter = (markdown: string): PageText => {
  const match = /^---\n([\s\S]*?)\n---\n\n?/.exec(markdown)
  // its lines, split on \n alone: a value with a U+2028 in it (JSON keeps it raw) is one line, so it can never pass
  // for a key of its own
  const lines = (match?.[1] ?? '').split('\n')
  const read = (key: string) => {
    const raw = lines.find((line) => line.startsWith(`${key}: `))?.slice(key.length + 2)
    if (!raw) return undefined
    try {
      return String(JSON.parse(raw))
    } catch {
      return raw
    }
  }
  return {
    title: read('title'),
    description: read('description'),
    body: match ? markdown.slice(match[0].length) : markdown,
  }
}

const origin = (request: Request, options: MdHandlerOptions) =>
  options.origin ?? process.env.AFFORDANCES_MD_ORIGIN ?? new URL(request.url).origin

// the public site, whoever asks: everything the app gives (pages, sections, a page's markdown, append, the headers
// option) sees one request with none of the visitor's headers, as a twin's public view does. the headers option is
// resolved once per llms request, never once per page it renders. cached for publicCache's time, unless the headers
// option or the caller carries credentials: a caller with them may have shaped it (a markdown() or a section reading
// cookies()), so it's theirs
const publicSite = async <O extends LlmsFetchOptions>(
  caller: Request,
  given: O,
  cache: string | undefined,
) => {
  const request = viewRequest(caller)
  const options = { ...given, headers: await extraHeaders(request, given.headers) }
  const index = await siteIndex(request, options)
  const personal = credentialed(options.headers) || credentialed(caller.headers)
  return {
    request,
    options,
    index,
    routes: staticRoutes(index),
    cache: personal ? undefined : cache,
  }
}

const text = (body: string, cache: string | undefined, failed: number) =>
  new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': cache ?? 'private, no-store',
      ...(failed && { [DROPPED_HEADER]: String(failed) }),
    },
  })
// an hour unless publicCache says otherwise, false for never. checked when the handler is made (checked), so a value
// here is one; revalidate 0, a page that's never cached, gives none
const llmsCache = (value: LlmsCache | undefined) =>
  value === undefined
    ? 'public, max-age=0, s-maxage=3600'
    : value === false
      ? undefined
      : publicCacheControl(value).header

// a file missing pages that failed to render, which no cache keeps: the next request renders them again. the count
// only, as in the header
const incomplete = (file: string, failed: number) =>
  new Response(
    `${file} is incomplete: ${failed} ${failed === 1 ? 'page' : 'pages'} couldn't be rendered. Retry in ${RETRY_AFTER} seconds.\n`,
    {
      status: 503,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
        'retry-after': String(RETRY_AFTER),
        [DROPPED_HEADER]: String(failed),
      },
    },
  )

// "Cart · Acme Store" → "Cart", given the site's name
const short = (name: string | undefined, label: string | undefined) =>
  name && label
    ? label.replace(new RegExp(`\\s*[${TITLE_SEPARATORS}]\\s*${escapeRegExp(name)}$`), '')
    : label

// which pages to include: yours, given the index's routes without a dynamic segment, or those routes as they are
// a page of llms-full.txt: a path, rendered from its markdown route, or its markdown given outright (from a data layer),
// which is never rendered or fetched. its links are made absolute and point at twins, as a rendered page's are
export type LlmsFullPage =
  | string
  | {
      url: string
      title?: string
      markdown: string | ((request: Request) => string | Promise<string>)
    }
export type Pages = (request: Request, routes: string[]) => LlmsFullPage[] | Promise<LlmsFullPage[]>

// what the llms handlers use for their own requests. how each page renders is its markdown route's (createMdHandler's
// options there), since each page is fetched from it
export type LlmsFetchOptions = Pick<MdHandlerOptions, 'origin' | 'headers' | 'timeout'> & {
  // how many pages render at once, 8 by default: each is a full render on the same server. timeout is each page's own
  concurrency?: number
  // how long the whole file may take, 25s by default; a page not rendered by then failed, so llms-full.txt answers
  // 503. raise it with the route's maxDuration
  deadline?: number
  // how long a CDN may keep the file: a cacheLife profile, or { revalidate, expire? } in seconds, as markdown.ts's
  // publicCache takes; an hour by default, false for never. a file rendered with credentials, or missing a page that
  // failed, is never kept
  publicCache?: LlmsCache
}
// a profile of next's own, or one next.config's cacheLife adds
export type LlmsCache = PublicCache<CacheLifeProfile | (string & {})> | false

export type LlmsFullOptions = LlmsFetchOptions & {
  // the pages to include, in order: paths, or { url, title?, markdown }; defaults to every page that needs no params
  pages?: Pages
  // more markdown at the end of the file, as createMdHandler's append; head each block `# Title (url)`, as pages are
  append?: MdHandlerOptions['append']
}

// app/llms-full.txt/route.ts: every page's markdown in one file, from the same render and converter as /x.md.
// rendered without the caller's cookies, so it's the public site; each page is headed `# Title (url)`
export const createLlmsFullHandler = ({ pages, append, ...given }: LlmsFullOptions = {}) => {
  const publicCache = checked(given)
  return async (caller: Request): Promise<Response> => {
    const { request, options, index, routes, cache } = await publicSite(caller, given, publicCache)
    const list = pages ? await pages(request, routes) : routes
    const paths = list.filter((page) => typeof page === 'string')
    const links = twinLinks(new URL(request.url))
    // the site's own markdown (an object page's markdown(), append) starts alongside the renders, never after them,
    // each with its failure caught as it happens: one that threw may give it next time, so the file isn't whole
    const ofSite = list.map(
      async (page): Promise<{ rendered: Rendered; read?: PageText } | undefined> => {
        if (typeof page === 'string') return undefined
        // a url that doesn't parse is a failed page, as a markdown() that throws is, never an unhandled rejection
        if (!URL.canParse(page.url, request.url))
          return { rendered: { path: page.url, failed: "its url doesn't parse" } }
        const url = new URL(page.url, request.url).href
        try {
          const markdown =
            typeof page.markdown === 'function' ? await page.markdown(request) : page.markdown
          return {
            rendered: { path: page.url, markdown },
            read: { title: page.title, body: relinkMarkdown(markdown, url, links) },
          }
        } catch (error) {
          return { rendered: { path: page.url, failed: `markdown() threw: ${String(error)}` } }
        }
      },
    )
    const appended = (async () => {
      try {
        return { extra: (await append?.(request))?.trim() }
      } catch (error) {
        return { failed: `append threw: ${String(error)}` }
      }
    })()
    const fetched = await renderPages(request, [...new Set(paths)], options)
    const byPath = new Map(fetched.map((rendered) => [rendered.path, rendered]))
    // each in order: a path's rendered markdown, or an object's own, its links resolved against its url
    const entries = await Promise.all(
      list.map(async (page, i) => {
        if (typeof page !== 'string') return (await ofSite[i])!
        const rendered = byPath.get(page)!
        return { rendered, read: rendered.markdown ? frontmatter(rendered.markdown) : undefined }
      }),
    )
    const tail = await appended
    if (tail.failed) entries.push({ rendered: { path: 'append', failed: tail.failed } })
    const texts = entries.map(({ read }) => read)
    const shared = sharedTitles(texts)
    const parts = entries.map(({ rendered, read }) =>
      read ? fullPage(read, new URL(rendered.path, request.url).href, index?.name, shared) : '',
    )
    // a page that failed is missing, so the file isn't whole: never sent as if it were
    const failed = dropped(
      'llms-full.txt',
      entries.map(({ rendered }) => rendered),
    )
    if (failed) {
      // in production, once per process: the server's log is where a 503 the site never sees gets named (development
      // names each failed page on every request)
      const named = entries.flatMap(({ rendered }) =>
        rendered.failed ? [`${rendered.path} (${rendered.failed})`] : [],
      )
      once(
        'llms-full 503',
        `[affordances-md] llms-full.txt answered 503: ${named.join(', ')}. It's never cached until every page renders: raise the deadline and the route's maxDuration, or cache the pages' twins.`,
        { production: 'only' },
      )
      return incomplete('llms-full.txt', failed)
    }
    return text(`${[...parts, tail.extra].filter(Boolean).join('\n\n')}\n`, cache, 0)
  }
}

// a title more than one page has (a layout's, for every page) isn't a page's name
const sharedTitles = (pages: (PageText | undefined)[]) => {
  const titles = pages.flatMap((page) => page?.title ?? [])
  return new Set(titles.filter((title, i) => titles.indexOf(title) !== i))
}
// a page's name in llms.txt and llms-full.txt: its frontmatter title, without the site's name. its own first heading
// names it instead when the title is that heading in a template, as pageTitle reads one ("Cart" for "Cart · Acme",
// never "Sign" for "Sign-in · Acme"), or when the title isn't the page's own (the site's name, or one other pages
// share)
const pageName = (
  title: string | undefined,
  own: string | undefined,
  name: string | undefined,
  shared: Set<string>,
) => {
  const label = title && !shared.has(title) ? short(name, title) : undefined
  return (own && (!label || label === name || pageTitle(label, own) === own) ? own : label) || own
}
// a page in llms-full.txt, headed `# Name (url)`: its own heading, when that names it, isn't repeated; any other stays
const fullPage = (page: PageText, url: string, name: string | undefined, shared: Set<string>) => {
  const at = headingOf(page.body)
  const own = at?.text
  const heading = pageName(page.title, own, name, shared)
  if (!heading) return page.body.trim()
  // spliced in where the heading is, never replaced as text: a title or url with $' in it is as written
  if (at && own === heading)
    return `${page.body.slice(0, at.start)}# ${plain(heading)} (${url})${page.body.slice(at.end)}`.trim()
  return `# ${plain(heading)} (${url})\n\n${page.body.trim()}`
}

// a concurrency that renders nothing, one page forever, or a cache time that isn't one, is a mistake to say when the
// handler is made. the file's Cache-Control, when it may have one
const checked = (options: LlmsFetchOptions) => {
  const { concurrency, deadline, publicCache } = options
  const problem =
    publicCache === undefined || publicCache === false
      ? undefined
      : publicCacheControl(publicCache).problem
  if (problem) throw new TypeError(`[affordances-md] publicCache ${problem}, or false`)
  if (concurrency !== undefined && !(Number.isInteger(concurrency) && concurrency >= 1))
    throw new TypeError(
      `[affordances-md] concurrency is how many pages render at once, a whole number from 1; got ${concurrency}`,
    )
  if (deadline !== undefined && !(deadline > 0))
    throw new TypeError(
      `[affordances-md] deadline is how long the whole file may take, in milliseconds above 0; got ${deadline}`,
    )
  return llmsCache(publicCache)
}

// a page in llms.txt: a path whose title and description come from its own markdown, or given outright
export type LlmsLink = string | { url: string; title: string; description?: string }
// a ## section of llms.txt: its links, its intro, or both
// a section of llms.txt, under `## `: its intro, its links, then sections of its own, under `### ` and down to `###### `
export type LlmsSection = {
  title: string
  intro?: string
  pages?: LlmsLink[]
  sections?: LlmsSection[]
}

export type LlmsTxtOptions = LlmsFetchOptions & {
  // the `# ` heading; defaults to the site index's name
  title?: string
  // the `> ` summary under it
  summary?: string
  // what the plugin says after the summary: that every page is markdown, where llms-full.txt is, and on an Affordances
  // site how to read its graphs. markdown of your own instead, or false for none
  note?: string | false
  // more markdown before the page lists, after the note, e.g. how to use the site
  intro?: string
  // the page lists, under `## ` headings; defaults to one Pages list of every page that needs no params. a section's
  // intro is markdown under its heading, before its links; one with only an intro is prose
  sections?: (request: Request, routes: string[]) => LlmsSection[] | Promise<LlmsSection[]>
  // where llms-full.txt is, to link it; false when there isn't one
  full?: string | false
}

// app/llms.txt/route.ts: the llms.txt index (https://llmstxt.org). Each page links its markdown twin, with its
// title, and the route's description from the Affordances index (the page's own description otherwise). An
// Affordances site also says how to read its graphs, so an agent that starts here can act, not just read
export const createLlmsTxtHandler = ({
  title,
  summary,
  note,
  intro,
  sections,
  full = '/llms-full.txt',
  ...given
}: LlmsTxtOptions = {}) => {
  const publicCache = checked(given)
  return async (caller: Request): Promise<Response> => {
    const { request, options, index, routes, cache } = await publicSite(caller, given, publicCache)
    const lists: LlmsSection[] = sections
      ? await sections(request, routes)
      : [{ title: 'Pages', pages: routes }]
    const abs = (path: string) => new URL(path, request.url).href
    const twin = (path: string) => abs(mdPath(path))
    // a route's own description, written for agents in its state.ts
    const described = new Map(index?.routes.map((r) => [r.route, r.description]) ?? [])

    const all = (list: LlmsSection[]): LlmsSection[] =>
      list.flatMap((section) => [section, ...all(section.sections ?? [])])
    const paths = all(lists).flatMap(
      (list) => list.pages?.filter((link) => typeof link === 'string') ?? [],
    )
    const pages = await renderPages(request, [...new Set(paths)], options)
    const texts = pages.map(({ markdown }) => (markdown ? frontmatter(markdown) : undefined))
    const shared = sharedTitles(texts)
    const rendered = new Map(pages.map(({ path }, i) => [path, texts[i]]))
    const name = title ?? index?.name
    // markdown of the app's own, its links resolved against this file's url, as a page's are: an agent reading
    // llms.txt on its own can follow them, and those to the site's pages go to their twins
    const relinked = (markdown: string | undefined) =>
      markdown && relinkMarkdown(markdown, request.url, twinLinks(new URL(request.url)))
    const line = (link: LlmsLink) => {
      if (typeof link !== 'string')
        return `- [${link.title}](${twin(link.url)})${link.description ? `: ${link.description}` : ''}`
      const page = rendered.get(link)
      const own = page && headingOf(page.body)?.text
      // a home page titled just the site name reads better as Home
      const label =
        (link === '/' && page?.title === name
          ? 'Home'
          : pageName(page?.title, own, name, shared)) || link
      const description = described.get(link) ?? page?.description
      return `- [${plain(label)}](${twin(link)})${description ? `: ${plain(description)}` : ''}`
    }

    // the plugin's own sentences, unless the note replaces them
    const said = [
      [
        'Every page is also Markdown: add `.md` to its URL, or request it with `Accept: text/markdown`.',
        full && `For the full text in one file, see [llms-full.txt](${abs(full)}).`,
      ]
        .filter(Boolean)
        .join(' '),
      index &&
        `This site is Affordances-enabled: request any page with \`Accept: application/vnd.affordances+json\` for its graph (what the page shows, and the actions you can call there, with their inputs). [${SITE_INDEX}](${abs(SITE_INDEX)}) lists every route and its actions.`,
    ]
    const head = [
      `# ${name ?? new URL(request.url).host}`,
      summary && `> ${summary}`,
      ...(note === false ? [] : note === undefined ? said : [relinked(note.trim())]),
      relinked(intro),
    ]
    // a section with nothing in it, at any depth, is left out, as an empty list was
    const filled = (list: LlmsSection): boolean =>
      Boolean(list.pages?.length || list.intro?.trim() || list.sections?.some(filled))
    const section = (list: LlmsSection, depth: number): string => {
      if (depth > 6)
        throw new TypeError(
          `[affordances-md] llms.txt's section "${list.title}" is nested deeper than ######, Markdown's last heading level`,
        )
      return [
        `${'#'.repeat(depth)} ${list.title}`,
        relinked(list.intro?.trim()),
        list.pages?.map(line).join('\n'),
        ...(list.sections ?? []).filter(filled).map((inner) => section(inner, depth + 1)),
      ]
        .filter(Boolean)
        .join('\n\n')
    }
    const body = lists.filter(filled).map((list) => section(list, 2))
    // a page that failed to render is still linked, by its path, so every link is there and right, and the file
    // stays cacheable; its header counts them
    const failed = dropped('llms.txt', pages)
    return text(`${[...head, ...body].filter(Boolean).join('\n\n')}\n`, cache, failed)
  }
}

// with its .js, as proxy.ts imports it: next.config loads this entry in plain node
import { NextRequest } from 'next/server.js'
import {
  fromDigest,
  headingOf,
  type Page,
  readPage,
  relinkMarkdown,
  type SlotNames,
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
  LITERAL_ENV,
  ROUTES_ENV,
  scanApp,
  sourceRegex,
  linkSources,
  toSource,
  writeMarkdownRoutes,
} from './routes.ts'
import {
  accepts,
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
  return [...own, ...aliasAlternates(aliases), ...merged]
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
        ...(cacheLife && { [CACHE_LIFE_ENV]: cacheLife }),
        ...(literalMd.length && { [LITERAL_ENV]: JSON.stringify(literalMd) }),
        ...(aliased.length && { [ALIASES_ENV]: JSON.stringify(aliased) }),
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
        return link ? withAlternates(user, pages, aliases) : user
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

// the page's html as far as it streams before the deadline. undefined past maxBytes; complete is false when the
// deadline or a broken stream cut it short
const streamed = async (response: Response, deadline: Promise<void>, maxBytes: number) => {
  if (!response.body) return { html: '', complete: true }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const late = deadline.then(() => undefined)
  let html = ''
  let size = 0
  try {
    for (;;) {
      const chunk = await Promise.race([reader.read(), late])
      if (!chunk) break
      if (chunk.done) return { html: html + decoder.decode(), complete: true }
      size += chunk.value.byteLength
      if (size > maxBytes) {
        void reader.cancel().catch(() => {})
        return undefined
      }
      html += decoder.decode(chunk.value, { stream: true })
    }
  } catch {
    // the fetch was aborted at the deadline mid-read
  }
  void reader.cancel().catch(() => {})
  return { html: html + decoder.decode(), complete: false }
}

const extraHeaders = async (request: Request, headers: MdHandlerOptions['headers']) =>
  new Headers(typeof headers === 'function' ? await headers(request) : headers)

const respond = (body: string, status: number, headers: Record<string, string> = {}) =>
  new Response(body, {
    status,
    headers: { 'content-type': 'text/markdown; charset=utf-8', vary: 'Accept', ...headers },
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

// the page's response as it came: status, headers (set-cookie and vary too) and body. undefined when its headers
// didn't arrive by the timeout; the body then streams on, never cut short
const passPage = async (request: Request, target: URL, options: MdHandlerOptions) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeout ?? TIMEOUT)
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
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

// a redirect as next gives it, from wherever it came: the page's own 3xx, the refresh meta it streams for a redirect()
// after the shell (readPage's redirect), or the digest of a redirect() thrown in markdown.ts
type NextRedirect = { status: number; location: string | null }
// how a redirect answering a markdown request is cached: private, no-store, or the page's own cache-control
type RedirectCache = { private: boolean; personal?: boolean; cacheControl?: string }

// every redirect a markdown request gets: to the target's twin when it has one (twinLocation: a page on this site,
// with its /. guard), otherwise as it is, never followed. it varies on Accept
const markdownRedirect = (
  { status, location }: NextRedirect,
  target: URL,
  cache: RedirectCache,
) => {
  const to = (location && twinLocation(new URL(location, target), target)) ?? location
  return new Response(null, {
    status,
    headers: {
      ...(to && { location: to }),
      vary: 'Accept',
      ...(cache.private
        ? { 'cache-control': 'private, no-store' }
        : cache.cacheControl && { 'cache-control': cache.cacheControl }),
      ...(cache.personal && { [PERSONAL_HEADER]: '1' }),
    },
  })
}

// an answer of the handler's own, never cached; personal when it was made with someone's credentials
const fail = (status: number, message: string, personal = false) =>
  respond(`# ${message}\n`, status, {
    'cache-control': 'private, no-store',
    ...(personal && { [PERSONAL_HEADER]: '1' }),
  })

// a path on the site's own origin as a url, or undefined: new URL reads one that starts with //host as another
// origin, and the caller's credentials (or the headers option) never go there
const pageUrl = (request: Request, options: MdHandlerOptions, path: string) => {
  const base = new URL(origin(request, options))
  const url = new URL(path, base)
  return url.origin === base.origin ? url : undefined
}

// renders the page as html the normal way (real RSC, Suspense, auth), then converts it
const convertPage =
  (options: MdHandlerOptions) =>
  async (request: Request, pagePath: string, direct: boolean): Promise<Response> => {
    const { timeout = TIMEOUT, maxBytes = 6 * MIB, append } = options
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
    if (request.headers.get('rsc'))
      return (
        (await passPage(request, target, options)) ??
        fail(504, `${target.pathname} took longer than ${timeout}ms to render`)
      )
    // a route handler next routes the url to (/llms.txt, or /og/[slug] where no static page beats it), asked for with
    // Accept: its own response, as it is, with the caller's own headers, never a render of ours
    if (pageRoute(target.pathname, { strict: true })?.handler)
      return (
        (await passPage(request, target, options)) ??
        fail(504, `${target.pathname} took longer than ${timeout}ms to render`)
      )
    // the route's own markdown.ts, when it has one and gives something, instead of rendering the page
    // only for a request that came in at the page's own url (/x.md, or /x with Accept), the url proxy.ts gated. one
    // made straight to the handler's url (/api/affordances/md/x) skipped a page-scoped gate, so it gets the html render,
    // which goes through the proxy at the page's url
    const route = direct ? undefined : await markdownRoute(request, target)
    // whose request this is: the caller's own credentials, or none, so the headers option's may stand in
    const callerCredentials = credentialed(request.headers)
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
    const asked = oneView ? view : request
    const routed = route && oneView ? { ...route, args: { ...route.args, request: asked } } : route
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
    } catch {
      clearTimeout(timer)
      return slow()
    }

    // the page's own redirect, or one it streamed, is cached as the page would be
    const cacheControl = upstream.headers.get('cache-control') ?? ''
    const pageCache: RedirectCache = {
      private:
        negotiated ||
        callerCredentials ||
        serviceCredentials ||
        /private|no-store/.test(cacheControl) ||
        upstream.headers.has('set-cookie'),
      cacheControl,
    }
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
    const tooLarge = () => {
      const limit = maxBytes % MIB ? `${maxBytes} bytes` : `${maxBytes / MIB} MiB`
      const fix = `To convert it, raise maxBytes in the md route (app/api/affordances/md/[[...path]]/route.ts): \`export const GET = createMdHandler({ maxBytes: ${Math.ceil((2 * maxBytes) / MIB)} * 1024 * 1024 })\`.`
      console.warn(
        `[affordances-md] ${target.pathname} is larger than maxBytes (${limit}), so it answers 413. ${fix}`,
      )
      return fail(
        413,
        `The page is too large to convert\n\nIts HTML is larger than ${limit} (maxBytes). ${fix}`,
      )
    }
    if (Number(upstream.headers.get('content-length') ?? 0) > maxBytes) {
      clearTimeout(timer)
      return tooLarge()
    }
    const body = await streamed(upstream, deadline, maxBytes)
    clearTimeout(timer)
    if (!body) return tooLarge()
    // a page whose shell arrived is converted as far as it streamed: boundaries still loading keep their fallback
    const partial = !body.complete
    if (partial && !body.html.trim()) return slow()
    // the page, read once: what it streamed, the slots it rendered, and its markdown
    const read = readPage(body.html, {
      url: target.href,
      link: options.linkTwins === false ? undefined : twinLinks(target),
    })
    // personal: rendered with someone's credentials (the caller's, or the route's service ones), or answered with a
    // cookie. a credential-free render is the anonymous public view, whatever cache-control next put on it (next
    // sends private, no-store for every dynamic render), so only this marks a page for llms to leave out
    const personalOnly = credentialed(headers) || upstream.headers.has('set-cookie')
    // a redirect(), notFound(), forbidden() or unauthorized() after the shell went out, which next streams in as a 200,
    // before any slot is filled
    const control = streamedAnswer(read, target, pageCache, personalOnly)
    if (control) return control
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
    if (shareable && upstream.headers.has('set-cookie') && !credentialed(headers))
      warnCookie(route!.route, target, upstream.headers)
    const varies = /(^|,)\s*accept-language\s*(,|$)/i.test(upstream.headers.get('vary') ?? '')
    if (shareable && varies) warnLanguage(route!.route)
    const shared =
      oneView && !personalOnly && !partial && upstream.status === 200
        ? publicHeader(route!.route, route!.module)
        : undefined
    return respond(markdown, upstream.status, {
      // a page that varies on the language the render was asked in varies the markdown too
      vary: varies && headers.has('accept-language') ? 'Accept, Accept-Language' : 'Accept',
      'x-affordances-tokens': String(Math.ceil(markdown.length / 4)),
      ...(result.url && { link: `<${result.url}>; rel="canonical"` }),
      // a partial page is never cached, so the next request gets the whole one
      ...(shared
        ? { 'cache-control': shared }
        : personal || partial
          ? { 'cache-control': 'private, no-store' }
          : cacheControl && { 'cache-control': cacheControl }),
      ...(partial && { [PARTIAL_HEADER]: '1' }),
      ...(personalOnly && { [PERSONAL_HEADER]: '1' }),
    })
  }

// the markdown of the page a request is for. a .md path on a literalMd route is the page itself when that answers
// with anything but a 404 (converted for a markdown request, passed through for any other), and a twin when it 404s
export const createMdHandler = (options: MdHandlerOptions = {}) => {
  const convert = convertPage(options)
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
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
  if (passed?.status === 404) void passed.body?.cancel().catch(() => {})
  // its Link, which md()'s rules leave off a url ending in .md, since there it would be a twin's too
  else if (passed?.ok && passed.headers.get('content-type')?.includes('text/html'))
    passed.headers.append('link', `<${mdPath(page)}>; ${LINK}`)
  return passed ?? fail(504, `${page} took longer than ${options.timeout ?? TIMEOUT}ms to render`)
}

// a route's params from its folder names, as next gives them to page.tsx: [x] is a string, [...x] a string[], and
// [[...x]] a string[] or left out. '/blog/[slug]' → { slug: string }; any string → every param a string or string[]
type SegmentParams<Segment extends string> = Segment extends `[[...${infer Name}]]`
  ? { [K in Name]?: string[] }
  : Segment extends `[...${infer Name}]`
    ? { [K in Name]: string[] }
    : Segment extends `[${infer Name}]`
      ? { [K in Name]: string }
      : Record<never, never>
// one branch: a leading / is an empty first segment, which has no params
type PathParams<Path extends string> = Path extends `${infer Segment}/${infer Rest}`
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
type RouteArgs<Route extends string> = MarkdownArgs<Route> & { route: Route }
// the generated check passes the app's own cacheLife profiles as Cache, so a custom name is typed and a typo isn't
export type MarkdownModule<Route extends string = string, Cache = PublicCache> = {
  default?: (args: RouteArgs<Route>) => MarkdownResult | Promise<MarkdownResult>
  slots?: Record<string, (args: RouteArgs<Route>) => SlotResult | Promise<SlotResult>>
  publicCache?: Cache
}
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
  const warn = (message: string) => {
    if (process.env.NODE_ENV !== 'production')
      console.warn(`[affordances-md] ${route}/markdown.ts, ${target.pathname}: ${message}`)
  }
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
  if ('location' in thrown) return markdownRedirect(thrown, target, { private: true, personal })
  return fail(thrown.status, HTTP_ERRORS[thrown.status]!, personal)
}
// the same, streamed after the shell as a flight error row: readPage's redirect or fallback
const streamedAnswer = (page: Page, target: URL, cache: RedirectCache, personal: boolean) => {
  if (page.redirect) return markdownRedirect(page.redirect, target, cache)
  if (page.fallback) return fail(page.fallback.status, HTTP_ERRORS[page.fallback.status]!, personal)
  return undefined
}

// the Cache-Control a route's publicCache gives, or undefined when it has none or it isn't one, which development
// says once per route: its markdown then stays as it would be without it
const told = new Set<string>()
const publicHeader = (route: string, module: MarkdownModule) => {
  if (module.publicCache === undefined) return undefined
  const { header, problem } = publicCacheControl(module.publicCache)
  if (problem && process.env.NODE_ENV !== 'production' && !told.has(route)) {
    told.add(route)
    console.error(
      `[affordances-md] ${route}/markdown.ts: publicCache ${problem}; until then, it isn't cached.`,
    )
  }
  return header
}
// a page that sets a cookie for an anonymous visitor (a session, an auth handshake) is never cached publicly: said in
// development, since its route asked to be
const warnCookie = (route: string, target: URL, headers: Headers) => {
  if (process.env.NODE_ENV === 'production') return
  const names = headers.getSetCookie().map((cookie) => cookie.split('=')[0]!.trim())
  console.warn(
    `[affordances-md] ${target.pathname} set ${names.length === 1 ? 'a cookie' : 'cookies'} (${names.join(', ')}) for an anonymous visitor, so ${route}/markdown.ts's publicCache doesn't apply: its markdown is private, no-store. Don't set ${names.length === 1 ? 'it' : 'them'} on this page for a visitor who isn't signed in.`,
  )
}

// an opted-in route whose page varies on the visitor's language: its public markdown is rendered without one, so
// it's the default language. said once per route, in development
const toldLanguage = new Set<string>()
const warnLanguage = (route: string) => {
  if (process.env.NODE_ENV === 'production' || toldLanguage.has(route)) return
  toldLanguage.add(route)
  console.warn(
    `[affordances-md] ${route}'s page varies on Accept-Language, but ${route}/markdown.ts's publicCache makes its markdown one view for everyone: it's rendered without the visitor's language, so it's the default language. For Markdown in each language, put the locale in the path (/fr/…).`,
  )
}

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
    if (personal || /private|no-store/.test(own)) passed.headers.set(PERSONAL_HEADER, '1')
    if (personal || negotiated || !own) passed.headers.set('cache-control', 'private, no-store')
    const vary = passed.headers.get('vary')
    if (!vary) passed.headers.set('vary', 'Accept')
    else if (!/(^|,)\s*accept\s*(,|$)/i.test(vary)) passed.headers.set('vary', `${vary}, Accept`)
    return passed
  }
  if (result === undefined) {
    // with slots, undefined is how a default export hands the page back to be converted and filled: no mistake to warn of
    if (process.env.NODE_ENV !== 'production' && !module.slots)
      console.warn(
        `[affordances-md] ${route}/markdown.ts returned nothing for ${target.pathname}, so its HTML is converted`,
      )
    return undefined
  }
  const given = typeof result === 'string' ? { markdown: result } : result
  const meta = {
    title: given.title ?? headingOf(given.markdown)?.text,
    description: given.description,
    url: target.href,
  }
  const page = `${yaml(meta)}${given.markdown.trim()}\n`
  const extra = await append?.(request)
  const body = extra ? `${page}\n${extra.trim()}\n` : page
  return respond(body, 200, {
    'x-affordances-tokens': String(Math.ceil(body.length / 4)),
    link: `<${target.href}>; rel="canonical"`,
    // it read data with whatever the request carried, which the handler can't tell a credential from (an x-api-key):
    // never cached, unless its markdown.ts says the route's markdown is public, and then only an anonymous .md
    'cache-control': (oneView && publicHeader(route, module)) || 'private, no-store',
    ...(personal && { [PERSONAL_HEADER]: '1' }),
  })
}

// app/api/affordances/md/[[...path]]/route.ts: export { GET } from '@affordances/md/next'
export const GET = /* @__PURE__ */ createMdHandler()

// llms.txt and llms-full.txt. both list the pages md() found in app/ and the routes of the site's own Affordances
// index when it serves one, which also gives the site's name and each route's description

// the protocol's well-known path; @affordances/md works without the rest of Affordances, so it's spelled out
const SITE_INDEX = '/.well-known/affordances.json'

type SiteIndex = { name?: string; routes: { route: string; description?: string }[] }

const siteIndex = async (
  request: Request,
  options: MdHandlerOptions,
): Promise<SiteIndex | undefined> => {
  try {
    const headers = await extraHeaders(request, options.headers)
    headers.set('accept', 'application/json')
    const response = await fetch(new URL(SITE_INDEX, origin(request, options)), {
      headers,
      signal: AbortSignal.timeout(options.timeout ?? TIMEOUT),
    })
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
  // one deadline for the whole file, under a serverless host's limit: a page not rendered by then is left out
  const deadline = options.deadline ?? DEADLINE
  const overall = new AbortController()
  const timer = setTimeout(() => overall.abort(), deadline)
  const late = `not rendered within the file's ${deadline}ms deadline`
  const render = async (path: string): Promise<Rendered> => {
    if (overall.signal.aborted) return { path, dropped: late }
    // a path from the site index, pages() or sections() that starts with //host or names another origin is never
    // fetched: the headers option (a bearer token, a bypass secret) stays on this site
    const target = pageUrl(request, options, path)
    if (!target) return { path, dropped: 'not on this site' }
    try {
      const headers = new Headers(options.headers)
      headers.set('accept', 'text/markdown')
      // each page's own timeout, from when its fetch starts, not from when the file was asked for
      const response = await fetch(target, {
        headers,
        redirect: 'manual',
        signal: AbortSignal.any([AbortSignal.timeout(timeout), overall.signal]),
      })
      // a page its markdown route rendered privately (with credentials of the route's own, a private page, a
      // cookie set in answer) isn't the public view: left out, so the files stay public. negotiated markdown is
      // private too, but only because of where it was served, so it counts
      if (!response.ok) return { path, dropped: `answered ${response.status}` }
      const type = response.headers.get('content-type') ?? 'no content-type'
      if (!type.startsWith('text/markdown'))
        return { path, dropped: `answered ${type}, not markdown` }
      if (response.headers.has(PERSONAL_HEADER) || response.headers.has('set-cookie'))
        return { path, dropped: 'private: rendered with credentials, or it set a cookie' }
      return { path, markdown: await response.text() }
    } catch (error) {
      if (overall.signal.aborted) return { path, dropped: late }
      const timedOut = error instanceof Error && error.name === 'TimeoutError'
      return {
        path,
        dropped: timedOut ? `took longer than ${timeout}ms` : `failed: ${String(error)}`,
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
type Rendered = { path: string; markdown?: string; dropped?: string }
const CONCURRENCY = 8
// under netlify's 26s for a synchronous function and vercel's limits; a host that allows more takes a longer one
const DEADLINE = 25_000

// pages llms left out: in development, a warning naming each and why; everywhere, their count in a header, never a
// list in the file, which is public and could name a private page
const dropped = (file: string, pages: Rendered[], what: string) => {
  const left = pages.filter((page) => page.dropped)
  if (left.length && process.env.NODE_ENV !== 'production')
    console.warn(
      `[affordances-md] ${file} ${what} ${left.length} ${left.length === 1 ? 'page' : 'pages'}: ${left.map((page) => `${page.path} (${page.dropped})`).join(', ')}`,
    )
  return left.length
}
const DROPPED_HEADER = 'x-affordances-md-dropped'

// a page's markdown as the converter writes it: its frontmatter's title and description (JSON-quoted values), and
// the markdown after it, read once
type PageText = { title?: string; description?: string; body: string }
const frontmatter = (markdown: string): PageText => {
  const match = /^---\n([\s\S]*?)\n---\n\n?/.exec(markdown)
  const block = match?.[1] ?? ''
  const read = (key: string) => {
    const raw = block.match(new RegExp(`^${key}: (.+)$`, 'm'))?.[1]
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

// the headers option, resolved once per llms request rather than once per page it renders
const resolved = async <O extends MdHandlerOptions>(request: Request, options: O) => ({
  ...options,
  headers: await extraHeaders(request, options.headers),
})

// the public site, unless the headers option rendered it with credentials
const text = (body: string, headers: Headers, left: number) =>
  new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': credentialed(headers)
        ? 'private, no-store'
        : 'public, max-age=0, s-maxage=3600',
      ...(left && { [DROPPED_HEADER]: String(left) }),
    },
  })

// "Cart · Acme Store" → "Cart", given the site's name
const short = (name: string | undefined, label: string | undefined) =>
  name && label ? label.replace(new RegExp(`\\s*[·|–—-]\\s*${literal(name)}$`), '') : label

// which pages to include: yours, given the index's routes without a dynamic segment, or those routes as they are
export type Pages = (request: Request, routes: string[]) => string[] | Promise<string[]>

// what the llms handlers use for their own requests. how each page renders is its markdown route's (createMdHandler's
// options there), since each page is fetched from it
export type LlmsFetchOptions = Pick<MdHandlerOptions, 'origin' | 'headers' | 'timeout'> & {
  // how many pages render at once, 8 by default: each is a full render on the same server. timeout is each page's own
  concurrency?: number
  // how long the whole file may take, 25s by default; pages not rendered by then are left out. raise it with the
  // route's maxDuration
  deadline?: number
}

export type LlmsFullOptions = LlmsFetchOptions & {
  // the paths to include, in order; defaults to every page that needs no params
  pages?: Pages
}

// app/llms-full.txt/route.ts: every page's markdown in one file, from the same render and converter as /x.md.
// rendered without the caller's cookies, so it's the public site; each page is headed `# Title (url)`
export const createLlmsFullHandler = ({ pages, ...given }: LlmsFullOptions = {}) => {
  checked(given)
  return async (request: Request): Promise<Response> => {
    const options = await resolved(request, given)
    const index = await siteIndex(request, options)
    const routes = staticRoutes(index)
    const paths = pages ? await pages(request, routes) : routes
    const rendered = await renderPages(request, paths, options)
    const texts = rendered.map(({ markdown }) => (markdown ? frontmatter(markdown) : undefined))
    const shared = sharedTitles(texts)
    const parts = rendered.map(({ path }, i) => {
      const page = texts[i]
      return page ? fullPage(page, new URL(path, request.url).href, index?.name, shared) : ''
    })
    const left = dropped('llms-full.txt', rendered, 'left out')
    return text(`${parts.filter(Boolean).join('\n\n')}\n`, options.headers, left)
  }
}

// a title more than one page has (a layout's, for every page) isn't a page's name
const sharedTitles = (pages: (PageText | undefined)[]) => {
  const titles = pages.flatMap((page) => page?.title ?? [])
  return new Set(titles.filter((title, i) => titles.indexOf(title) !== i))
}
// a page's name in llms.txt and llms-full.txt: its frontmatter title, without the site's name. its own first heading
// names it instead when that's the title's start ("Cart" for "Cart · Acme", as before), or when the title isn't the
// page's own (the site's name, or one other pages share)
const pageName = (
  title: string | undefined,
  own: string | undefined,
  name: string | undefined,
  shared: Set<string>,
) => {
  const label = title && !shared.has(title) ? short(name, title) : undefined
  const starts =
    own &&
    label &&
    (label === own || (label.startsWith(own) && /^\s*[·|–—:-]/.test(label.slice(own.length))))
  return (own && (!label || label === name || starts) ? own : label) || own
}
// a page in llms-full.txt, headed `# Name (url)`: its own heading, when that names it, isn't repeated; any other stays
const fullPage = (page: PageText, url: string, name: string | undefined, shared: Set<string>) => {
  const at = headingOf(page.body)
  const own = at?.text
  const heading = pageName(page.title, own, name, shared)
  if (!heading) return page.body.trim()
  // spliced in where the heading is, never replaced as text: a title or url with $' in it is as written
  if (at && own === heading)
    return `${page.body.slice(0, at.start)}# ${heading} (${url})${page.body.slice(at.end)}`.trim()
  return `# ${heading} (${url})\n\n${page.body.trim()}`
}

// a concurrency that renders nothing, or one page forever, is a mistake to say when the handler is made
const checked = (options: LlmsFetchOptions) => {
  const { concurrency, deadline } = options
  if (concurrency !== undefined && !(Number.isInteger(concurrency) && concurrency >= 1))
    throw new TypeError(
      `[affordances-md] concurrency is how many pages render at once, a whole number from 1; got ${concurrency}`,
    )
  if (deadline !== undefined && !(deadline > 0))
    throw new TypeError(
      `[affordances-md] deadline is how long the whole file may take, in milliseconds above 0; got ${deadline}`,
    )
}

// a page in llms.txt: a path whose title and description come from its own markdown, or given outright
export type LlmsLink = string | { url: string; title: string; description?: string }
// a ## section of llms.txt: its links, its intro, or both
export type LlmsSection = { title: string; intro?: string; pages?: LlmsLink[] }

export type LlmsTxtOptions = LlmsFetchOptions & {
  // the `# ` heading; defaults to the site index's name
  title?: string
  // the `> ` summary under it
  summary?: string
  // more markdown before the page lists, e.g. how to use the site
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
  intro,
  sections,
  full = '/llms-full.txt',
  ...given
}: LlmsTxtOptions = {}) => {
  checked(given)
  return async (request: Request): Promise<Response> => {
    const options = await resolved(request, given)
    const index = await siteIndex(request, options)
    const routes = staticRoutes(index)
    const lists: LlmsSection[] = sections
      ? await sections(request, routes)
      : [{ title: 'Pages', pages: routes }]
    const abs = (path: string) => new URL(path, request.url).href
    const twin = (path: string) => abs(mdPath(path))
    // a route's own description, written for agents in its state.ts
    const described = new Map(index?.routes.map((r) => [r.route, r.description]) ?? [])

    const paths = lists.flatMap(
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
      return `- [${label}](${twin(link)})${description ? `: ${description}` : ''}`
    }

    const head = [
      `# ${name ?? new URL(request.url).host}`,
      summary && `> ${summary}`,
      relinked(intro),
      [
        'Every page is also Markdown: add `.md` to its URL, or request it with `Accept: text/markdown`.',
        full && `[llms-full.txt](${abs(full)}) has every page in one file.`,
      ]
        .filter(Boolean)
        .join(' '),
      index &&
        `This site is Affordances-enabled: request any page with \`Accept: application/vnd.affordances+json\` for its graph (what the page shows, and the actions you can call there, with their inputs). [${SITE_INDEX}](${abs(SITE_INDEX)}) lists every route and its actions.`,
    ]
    // a section with neither links nor an intro is left out, as an empty list was
    const body = lists
      .filter((list) => list.pages?.length || list.intro?.trim())
      .map((list) =>
        [`## ${list.title}`, relinked(list.intro?.trim()), list.pages?.map(line).join('\n')]
          .filter(Boolean)
          .join('\n\n'),
      )
    // a page that rendered no markdown is still linked, by its path, so the index stays whole
    const left = dropped('llms.txt', pages, 'has no title or description for')
    return text(`${[...head, ...body].filter(Boolean).join('\n\n')}\n`, options.headers, left)
  }
}

// a string matched as itself in a RegExp
const literal = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

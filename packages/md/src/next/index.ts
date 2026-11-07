import { htmlToMarkdown, yaml } from '../convert/index.ts'
import { mdPath } from '../path.ts'
import { mdPagePath } from './proxy.ts'
import {
  builtPages,
  LITERAL_ENV,
  ROUTES_ENV,
  scanApp,
  sourceRegex,
  toSource,
  unescapeSource,
  writeMarkdownRoutes,
} from './routes.ts'
import {
  accepts,
  apiRoute,
  handlerPrefix,
  isLiteral,
  LINK,
  MD_PATH,
  notOursOrRsc,
  pageRegex,
  present,
  RENDER_HEADER,
  rewrites,
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

// each page's Link header: /products/[slug] → </products/:slug.md>, filled in by next per request. next can't fill
// in an empty optional catch-all (/docs/:slug* at /docs), so its parent's url gets a part of its own
const alternates = (pages: string[]) =>
  pages
    .filter((route) => !apiRoute.test(route))
    .map((route) => {
      const optional = route.match(/^(.*?)\/?\[\[\.\.\.([^\]]+)\]\]$/)
      const parts = optional ? [optional[1] || '/', `${optional[1]}/[...${optional[2]}]`] : [route]
      return {
        source: toSource(route),
        parts: parts.map(toSource).map((source) => ({
          source: notInternal(notTwin(source)),
          value: `<${mdPath(unescapeSource(source.replace(/(?<!\\)\+$/, ''))).replace(/[?#\\]/g, encodeURIComponent)}>; ${LINK}`,
        })),
      }
    })

// a rule already setting Link on a page's source (Affordances' rel="affordances") gets ours appended, split into
// the same parts: next keeps only the last value of a header two rules set, so a separate rule would replace it
const withAlternates = (user: Header[], pages: string[]): Header[] => {
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
  // first, so a Link the app sets itself on a broader source still wins
  return [...own, ...merged]
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
}

// a next config wrapper, like createMDX(): md()(config), or withAffordances(config, { plugins: [md()] })
export const md =
  ({ root = process.cwd(), link = true, literalMd = [] }: MdOptions = {}) =>
  <C extends Config>(config: C): C => {
    // read once, when next loads its config; a page or markdown.ts added during next dev shows up after a restart
    const { pages, markdown } = scanApp(root)
    const generated = writeMarkdownRoutes(root, markdown)
    // a source next would reject throws here, not on the first request
    for (const source of literalMd) sourceRegex(source)
    return {
      ...config,
      env: {
        ...config.env,
        [ROUTES_ENV]: JSON.stringify(pages),
        ...(literalMd.length && { [LITERAL_ENV]: JSON.stringify(literalMd) }),
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
        return link ? withAlternates(user, pages) : user
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

// a route md() found as a regex over a pathname: /products/[slug], /docs/[...slug], /docs/[[...slug]]
const segmentRegex = (segment: string) => {
  if (segment.startsWith('[[...')) return '(?:/.+)?'
  if (segment.startsWith('[...')) return '/.+'
  if (segment.startsWith('[')) return '/[^/]+'
  return segment && `/${segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`
}
const routeRegex = (route: string) =>
  new RegExp(`^${route.split('/').slice(1).map(segmentRegex).join('') || '/'}$`, 'i')

// a same-origin link to one of md()'s pages, as that page's twin with its search and hash. other origins, api
// routes, next's internals and links already ending in .md stay as they are, by the rewrites' own page rule, whatever
// routes there are; without md()'s pages, every link does
// compiled once per value of the env next inlined, not per conversion
let pageCache: { key: string | undefined; routes: RegExp[] } | undefined
const pageRoutes = () => {
  // spelled out: next inlines process.env.NAME, never process.env[name]
  const key = process.env.AFFORDANCES_MD_ROUTES
  if (!pageCache || pageCache.key !== key) pageCache = { key, routes: builtPages().map(routeRegex) }
  return pageCache.routes
}
const twinLinks = (base: URL) => {
  const routes = pageRoutes()
  if (!routes.length) return undefined
  return (url: URL) => {
    const path = url.pathname.replace(/(.)\/$/, '$1')
    // pageRegex leaves a .md path alone, since it's already a twin, except on a literalMd route, where /x/readme.md
    // is a page of its own and its twin is /x/readme.md.md
    const page = path === '/' || pageRegex.test(path) || isLiteral(path)
    if (url.origin !== base.origin || !page) return
    if (!routes.some((route) => route.test(path))) return
    // set on the url itself, so a path that starts with //host (/.//evil.test/x resolves to one) stays a path here
    const twin = new URL(url)
    twin.pathname = mdPath(path)
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

// the page's response as it came: status, headers (set-cookie and vary too) and body. undefined when its headers
// didn't arrive by the timeout; the body then streams on, never cut short. fetch has already decoded the body, so
// its encoding and length no longer describe it
const passPage = async (request: Request, target: URL, options: MdHandlerOptions) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeout ?? TIMEOUT)
  try {
    const upstream = await fetch(target, {
      headers: await asIs(request, options),
      redirect: 'manual',
      signal: controller.signal,
    })
    const headers = new Headers(upstream.headers)
    headers.delete('content-encoding')
    headers.delete('content-length')
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

const fail = (status: number, message: string) =>
  respond(`# ${message}\n`, status, { 'cache-control': 'private, no-store' })

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
    const { timeout = TIMEOUT, maxBytes = 6 * 1024 * 1024, append } = options
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
    // the route's own markdown.ts, when it has one and gives something, instead of rendering the page
    // only for a request that came in at the page's own url (/x.md, or /x with Accept), the url proxy.ts gated. one
    // made straight to the handler's url (/api/affordances/md/x) skipped a page-scoped gate, so it gets the html render,
    // which goes through the proxy at the page's url
    const authored = direct
      ? undefined
      : await authoredMarkdown(request, target, append, negotiated)
    if (authored) return authored
    const headers = new Headers()
    for (const name of FORWARD) {
      const value = request.headers.get(name)
      if (value) headers.set(name, value)
    }
    // the headers option's cookie and authorization (a service account's) apply only to a request that sent neither:
    // a signed-in person's markdown is rendered as them alone, never as more than they could see. all or nothing,
    // since an app checking a bearer first would otherwise render a cookie-signed-in person as the service
    const anonymous = !credentialed(request.headers)
    const optionHeaders = await extraHeaders(request, options.headers)
    for (const [name, value] of optionHeaders)
      if (anonymous || !CREDENTIALS.includes(name)) headers.set(name, value)
    headers.set('accept', 'text/html')
    headers.set(RENDER_HEADER, '1')
    // whose response this is: the caller's own credentials, or the service's that stood in, whose refreshed cookie
    // must never reach the caller
    const callerCredentials = credentialed(request.headers)
    const serviceCredentials = anonymous && credentialed(optionHeaders)

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

    // a same-origin redirect stays in markdown; one to another origin is passed on untouched, never followed. a
    // twin path that starts with //host (a return-to of /.//evil.test/x is same-origin) gets /. so a client resolves
    // it as a path on this site, never as another site. it's cached as the page would be, and varies on Accept
    if (upstream.status >= 300 && upstream.status < 400) {
      const location = upstream.headers.get('location')
      const next = location ? new URL(location, target) : undefined
      const twin = next && mdPath(next.pathname)
      const to =
        next?.origin === target.origin
          ? `${twin!.startsWith('//') ? '/.' : ''}${twin}${next.search}`
          : location
      const redirectCache = upstream.headers.get('cache-control') ?? ''
      const privately =
        negotiated ||
        callerCredentials ||
        serviceCredentials ||
        /private|no-store/.test(redirectCache) ||
        upstream.headers.has('set-cookie')
      clearTimeout(timer)
      return new Response(null, {
        status: upstream.status,
        headers: {
          ...(to && { location: to }),
          vary: 'Accept',
          ...(privately
            ? { 'cache-control': 'private, no-store' }
            : redirectCache && { 'cache-control': redirectCache }),
        },
      })
    }

    // anything else (a file in public/, json) is passed on as it came. fetch has already decoded the body, so its
    // encoding and length no longer describe it
    if (!upstream.headers.get('content-type')?.includes('text/html')) {
      // the deadline is for rendering a page; a file streams on to its end
      clearTimeout(timer)
      const passed = new Headers(upstream.headers)
      passed.delete('content-encoding')
      passed.delete('content-length')
      // credentialed means private; a cookie set in answer to the headers option's credentials is the service's
      if (serviceCredentials) passed.delete('set-cookie')
      if (callerCredentials || serviceCredentials) passed.set('cache-control', 'private, no-store')
      return new Response(upstream.body, { status: upstream.status, headers: passed })
    }
    const tooLarge = () => fail(413, 'The page is too large to convert')
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

    const result = htmlToMarkdown(body.html, {
      url: target.href,
      link: options.linkTwins === false ? undefined : twinLinks(target),
    })
    const page = partial
      ? `${result.markdown}\n> Some of this page was still loading after ${timeout}ms and is missing or shown as its loading state.\n`
      : result.markdown
    const extra = await append?.(request)
    const markdown = extra ? `${page}\n${extra.trim()}\n` : page

    // anything rendered with the caller's credentials, or that the page itself keeps private, stays private
    const cacheControl = upstream.headers.get('cache-control') ?? ''
    // personal: rendered with someone's credentials (the caller's, or the route's service ones), or answered with a
    // cookie. a credential-free render is the anonymous public view, whatever cache-control next put on it (next
    // sends private, no-store for every dynamic render), so only this marks a page for llms to leave out
    const personalOnly = credentialed(headers) || upstream.headers.has('set-cookie')
    const personal = personalOnly || /private|no-store/.test(cacheControl) || negotiated
    return respond(markdown, upstream.status, {
      // the handler forwards accept-language, so a page that varies on it varies the markdown too
      vary: /(^|,)\s*accept-language\s*(,|$)/i.test(upstream.headers.get('vary') ?? '')
        ? 'Accept, Accept-Language'
        : 'Accept',
      'x-affordances-tokens': String(Math.ceil(markdown.length / 4)),
      ...(result.url && { link: `<${result.url}>; rel="canonical"` }),
      // a partial page is never cached, so the next request gets the whole one
      ...(personal || partial
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

// app/**/markdown.ts, next to page.tsx: the page's markdown from its data, without rendering it
export type MarkdownArgs = {
  params: Record<string, string | string[]>
  searchParams: URLSearchParams
  request: Request
}
export type MarkdownResult =
  | string
  | { markdown: string; title?: string; description?: string }
  | Response
  | undefined
export type Markdown = (args: MarkdownArgs) => MarkdownResult | Promise<MarkdownResult>
export type MarkdownRoutes = Record<string, () => Promise<{ default: Markdown }>>

// a route's segments ranked as next ranks them: static, then [param], then [...catchAll], then [[...optional]]
const rank = (segment: string) =>
  segment.startsWith('[[...') ? 3 : segment.startsWith('[...') ? 2 : segment.startsWith('[') ? 1 : 0
const byRank = (a: string, b: string) => {
  const [x, y] = [a.split('/').slice(1), b.split('/').slice(1)]
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const order = rank(x[i] ?? '') - rank(y[i] ?? '')
    if (order) return order
  }
  return y.length - x.length
}
// the route a pathname is a page of, and its params; undefined when it's none of them
// strict, as next's own page routing is: case-sensitive, and segments compared and passed on as requested, never
// decoded (next gives a page its params encoded too), with no empty segment (//, a trailing /). the rewrites match loosely, so /Dashboard/1.md
// or /%64ashboard/1.md can reach the handler without a path-scoped proxy.ts matcher seeing it; those never get a
// markdown.ts, only the html render, whose own request the proxy gates
// a param as next gives it to the page: still encoded, in next's own encoding (x=1 is x%3D1)
const asParam = (segment: string) => {
  try {
    return encodeURIComponent(decodeURIComponent(segment))
  } catch {
    return segment
  }
}

const matchRoute = (ranked: string[], pathname: string) => {
  const parts = pathname === '/' ? [] : pathname.split('/').slice(1)
  if (parts.some((part) => !part)) return undefined
  for (const route of ranked) {
    const segments = route.split('/').slice(1).filter(Boolean)
    const params: Record<string, string | string[]> = {}
    const matched = segments.every((segment, i) => {
      const name = segment.replace(/^\[+(?:\.\.\.)?|\]+$/g, '')
      if (rank(segment) >= 2) {
        const rest = parts.slice(i)
        if (rest.length) params[name] = rest.map(asParam)
        return rest.length > 0 || rank(segment) === 3
      }
      if (rank(segment) === 1) {
        if (parts[i] === undefined) return false
        params[name] = asParam(parts[i]!)
        return true
      }
      return parts[i] === segment
    })
    const whole = segments.some((segment) => rank(segment) >= 2) || parts.length === segments.length
    if (matched && whole) return { route, params }
  }
  return undefined
}

// md()'s pages and the markdown.ts routes, in next's order, sorted once per value of the env and the routes
let rankedCache: { key: string; ranked: string[] } | undefined
const rankedRoutes = (routes: MarkdownRoutes) => {
  // spelled out: next inlines process.env.NAME, never process.env[name]
  const key = `${process.env.AFFORDANCES_MD_ROUTES}\0${Object.keys(routes).join('\0')}`
  if (!rankedCache || rankedCache.key !== key)
    rankedCache = {
      key,
      ranked: [...new Set([...builtPages(), ...Object.keys(routes)])].toSorted(byRank),
    }
  return rankedCache.ranked
}

const firstHeading = (markdown: string) => /^# (.+)$/m.exec(markdown)?.[1]?.trim()

// what a route's markdown.ts gives, as the handler's response: its markdown with the frontmatter, append and token
// count a converted page gets, or its own Response. private whenever the request carried credentials, since it read
// data as that person. undefined when there's no markdown.ts for the page, or it returned nothing
const authoredMarkdown = async (
  request: Request,
  target: URL,
  append: MdHandlerOptions['append'],
  negotiated: boolean,
): Promise<Response | undefined> => {
  // never next's internals or an api route, whatever a root catch-all would match
  if (/^\/(?:api|_next)(?:\/|$)/i.test(target.pathname)) return undefined
  const { routes } = await import('@affordances/md/routes')
  if (!routes) return undefined
  // the page next would render for this url, among all of md()'s pages: a static page without a markdown.ts isn't
  // taken over by a sibling [param] that has one
  const found = matchRoute(rankedRoutes(routes), target.pathname)
  if (!found || !(found.route in routes)) return undefined
  const { default: markdown } = await routes[found.route]!()
  const result = await markdown({
    params: found.params,
    searchParams: new URLSearchParams(target.search),
    request,
  })
  const personal = credentialed(request.headers)
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
    if (process.env.NODE_ENV !== 'production')
      console.warn(
        `[affordances-md] ${found.route}/markdown.ts returned nothing for ${target.pathname}, so its HTML is converted`,
      )
    return undefined
  }
  const given = typeof result === 'string' ? { markdown: result } : result
  const meta = {
    title: given.title ?? firstHeading(given.markdown),
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
    // never cached. an author who wants caching returns a Response with its own cache-control
    'cache-control': 'private, no-store',
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
) =>
  Promise.all(
    paths.map(async (path) => {
      // a path from the site index, pages() or sections() that starts with //host or names another origin is never
      // fetched: the headers option (a bearer token, a bypass secret) stays on this site
      const target = pageUrl(request, options, path)
      if (!target) return { path, markdown: undefined }
      try {
        const headers = new Headers(options.headers)
        headers.set('accept', 'text/markdown')
        const response = await fetch(target, {
          headers,
          redirect: 'manual',
          signal: AbortSignal.timeout(options.timeout ?? TIMEOUT),
        })
        // a page its markdown route rendered privately (with credentials of the route's own, a private page, a
        // cookie set in answer) isn't the public view: left out, so the files stay public. negotiated markdown is
        // private too, but only because of where it was served, so it counts
        const ok =
          response.ok &&
          response.headers.get('content-type')?.startsWith('text/markdown') &&
          !response.headers.has(PERSONAL_HEADER) &&
          !response.headers.has('set-cookie')
        return { path, markdown: ok ? await response.text() : undefined }
      } catch {
        return { path, markdown: undefined }
      }
    }),
  )

// the converter's frontmatter: title, description and url, as JSON-quoted values
const frontmatter = (markdown: string) => {
  const block = markdown.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? ''
  const read = (key: string) => {
    const raw = block.match(new RegExp(`^${key}: (.+)$`, 'm'))?.[1]
    if (!raw) return undefined
    try {
      return String(JSON.parse(raw))
    } catch {
      return raw
    }
  }
  return { title: read('title'), description: read('description') }
}

const origin = (request: Request, options: MdHandlerOptions) =>
  options.origin ?? process.env.AFFORDANCES_MD_ORIGIN ?? new URL(request.url).origin

// the headers option, resolved once per llms request rather than once per page it renders
const resolved = async <O extends MdHandlerOptions>(request: Request, options: O) => ({
  ...options,
  headers: await extraHeaders(request, options.headers),
})

// the public site, unless the headers option rendered it with credentials
const text = (body: string, headers: Headers) =>
  new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': credentialed(headers)
        ? 'private, no-store'
        : 'public, max-age=0, s-maxage=3600',
    },
  })

// which pages to include: yours, given the index's routes without a dynamic segment, or those routes as they are
export type Pages = (request: Request, routes: string[]) => string[] | Promise<string[]>

// what the llms handlers use for their own requests. how each page renders is its markdown route's (createMdHandler's
// options there), since each page is fetched from it
export type LlmsFetchOptions = Pick<MdHandlerOptions, 'origin' | 'headers' | 'timeout'>

export type LlmsFullOptions = LlmsFetchOptions & {
  // the paths to include, in order; defaults to every page that needs no params
  pages?: Pages
}

// app/llms-full.txt/route.ts: every page's markdown in one file, from the same render and converter as /x.md.
// rendered without the caller's cookies, so it's the public site; each page is headed `# Title (url)`
export const createLlmsFullHandler =
  ({ pages, ...given }: LlmsFullOptions = {}) =>
  async (request: Request): Promise<Response> => {
    const options = await resolved(request, given)
    const routes = staticRoutes(await siteIndex(request, options))
    const paths = pages ? await pages(request, routes) : routes
    const parts = (await renderPages(request, paths, options)).map(({ path, markdown }) =>
      markdown
        ? markdown
            .replace(/^---\n[\s\S]*?\n---\n\n/, '')
            .replace(/^# (.+)$/m, `# $1 (${new URL(path, request.url).href})`)
            .trim()
        : '',
    )
    return text(`${parts.filter(Boolean).join('\n\n')}\n`, options.headers)
  }

// a page in llms.txt: a path whose title and description come from its own markdown, or given outright
export type LlmsLink = string | { url: string; title: string; description?: string }

export type LlmsTxtOptions = LlmsFetchOptions & {
  // the `# ` heading; defaults to the site index's name
  title?: string
  // the `> ` summary under it
  summary?: string
  // more markdown before the page lists, e.g. how to use the site
  intro?: string
  // the page lists, under `## ` headings; defaults to one Pages list of every page that needs no params
  sections?: (
    request: Request,
    routes: string[],
  ) => { title: string; pages: LlmsLink[] }[] | Promise<{ title: string; pages: LlmsLink[] }[]>
  // where llms-full.txt is, to link it; false when there isn't one
  full?: string | false
}

// app/llms.txt/route.ts: the llms.txt index (https://llmstxt.org). Each page links its markdown twin, with its
// title, and the route's description from the Affordances index (the page's own description otherwise). An
// Affordances site also says how to read its graphs, so an agent that starts here can act, not just read
export const createLlmsTxtHandler =
  ({ title, summary, intro, sections, full = '/llms-full.txt', ...given }: LlmsTxtOptions = {}) =>
  async (request: Request): Promise<Response> => {
    const options = await resolved(request, given)
    const index = await siteIndex(request, options)
    const routes = staticRoutes(index)
    const lists = sections ? await sections(request, routes) : [{ title: 'Pages', pages: routes }]
    const abs = (path: string) => new URL(path, request.url).href
    const twin = (path: string) => abs(mdPath(path))
    // a route's own description, written for agents in its state.ts
    const described = new Map(index?.routes.map((r) => [r.route, r.description]) ?? [])

    const paths = lists.flatMap((list) => list.pages.filter((link) => typeof link === 'string'))
    const rendered = new Map<string, { title?: string; description?: string }>(
      (await renderPages(request, [...new Set(paths)], options)).map(({ path, markdown }) => [
        path,
        markdown ? frontmatter(markdown) : {},
      ]),
    )
    const name = title ?? index?.name
    // "Cart · Acme Store" → "Cart"
    const short = (label?: string) =>
      name && label ? label.replace(new RegExp(`\\s*[·|–—-]\\s*${literal(name)}$`), '') : label
    const line = (link: LlmsLink) => {
      if (typeof link !== 'string')
        return `- [${link.title}](${twin(link.url)})${link.description ? `: ${link.description}` : ''}`
      const meta = rendered.get(link) ?? {}
      // a home page titled just the site name reads better as Home
      const label = (link === '/' && meta.title === name ? 'Home' : short(meta.title)) || link
      const description = described.get(link) ?? meta.description
      return `- [${label}](${twin(link)})${description ? `: ${description}` : ''}`
    }

    const head = [
      `# ${name ?? new URL(request.url).host}`,
      summary && `> ${summary}`,
      intro,
      [
        'Every page is also Markdown: add `.md` to its URL, or request it with `Accept: text/markdown`.',
        full && `[llms-full.txt](${abs(full)}) has every page in one file.`,
      ]
        .filter(Boolean)
        .join(' '),
      index &&
        `This site is Affordances-enabled: request any page with \`Accept: application/vnd.affordances+json\` for its graph (what the page shows, and the actions you can call there, with their inputs). [${SITE_INDEX}](${abs(SITE_INDEX)}) lists every route and its actions.`,
    ]
    const body = lists
      .filter((list) => list.pages.length)
      .map((list) => `## ${list.title}\n\n${list.pages.map(line).join('\n')}`)
    return text(`${[...head, ...body].filter(Boolean).join('\n\n')}\n`, options.headers)
  }

// a string matched as itself in a RegExp
const literal = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

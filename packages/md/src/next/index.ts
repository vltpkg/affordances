import { htmlToMarkdown } from '../convert/index.ts'
import { mdPath } from '../path.ts'
import {
  builtLiteral,
  builtPages,
  LITERAL_ENV,
  ROUTES_ENV,
  scanPages,
  sourceRegex,
  toSource,
} from './routes.ts'

export { mdPath }

// where the rewrites send markdown requests; `affordances-md init` puts the route handler here
export const MD_PATH = '/api/affordances/md'
// set on the handler's own fetch of the page, so it never gets rewritten back to markdown
export const RENDER_HEADER = 'x-affordances-md-render'

export type Has = { type: 'header' | 'query'; key: string; value?: string }
export type Rewrite = { source: string; destination: string; has?: Has[]; missing?: Has[] }
export type Rewrites = { beforeFiles: Rewrite[]; afterFiles: Rewrite[]; fallback: Rewrite[] }
export type Header = { source: string; headers: { key: string; value: string }[] }
export type Config = {
  rewrites?: () => Promise<unknown> | unknown
  headers?: () => Promise<Header[]> | Header[]
  env?: Record<string, string | undefined>
}

const accepts: Has[] = [{ type: 'header', key: 'accept', value: '.*text/markdown.*' }]
const notOurs: Has[] = [{ type: 'header', key: RENDER_HEADER }]
// not our own render, and not next's client navigations, which ask for the RSC payload with an RSC header and an
// _rsc param. next hides both from a proxy.ts unless skipProxyUrlNormalize is set
const notOursOrRsc: Has[] = [
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
    { source: '/:path+.md', missing: notOurs, destination: `${MD_PATH}/:path+` },
  ],
} satisfies Partial<Rewrites>

const normalize = (value: unknown): Rewrites =>
  Array.isArray(value)
    ? { beforeFiles: [], afterFiles: value as Rewrite[], fallback: [] }
    : {
        beforeFiles: [],
        afterFiles: [],
        fallback: [],
        ...(value as Partial<Rewrites> | undefined),
      }

// the page a markdown request is for, from every shape next hands the handler: /api/affordances/md/x, /x.md,
// /index.md, and /x asked for with Accept → /x and /. case-insensitive, like next's own matching
const handlerPrefix = new RegExp(`^${MD_PATH}(?=/|$)`, 'i')
export const mdPagePath = (pathname: string) =>
  pathname
    .replace(handlerPrefix, '')
    .replace(/(^|\/)index\.md$/i, '/')
    .replace(/\.md$/i, '') || '/'

// the handler's path for a page: / → /api/affordances/md, /x → /api/affordances/md/x
const handlerPath = (page: string) => `${MD_PATH}${page === '/' ? '' : page}`

// next's `has` and `missing`: a header or query param that's present, not empty, and matches the value pattern if
// there is one
// each rule's value compiled once: mdRewrite runs on every request a proxy.ts sees
const patterns = new Map<string, RegExp>()
const pattern = (value: string) => {
  const compiled = patterns.get(value) ?? new RegExp(`^${value}$`)
  patterns.set(value, compiled)
  return compiled
}
const present = (request: Request, url: URL, { type, key, value }: Has) => {
  const actual = type === 'query' ? url.searchParams.get(key) : request.headers.get(key)
  return Boolean(actual) && (!value || pattern(value).test(actual!))
}
const matches = (request: Request, url: URL, { has = [], missing = [] }: Partial<Rewrite>) =>
  has.every((h) => present(request, url, h)) && !missing.some((h) => present(request, url, h))

// the rewrites' paths as regexes; the header and query conditions are read off the rules themselves
const pageRegex = new RegExp(`^/(?:${pagePattern})$`, 'i')
const isPage = (pathname: string) => pathname === '/' || pageRegex.test(pathname)
const suffixRegex = /^\/(?:[^/]+\/)*[^/]+\.md$/i

// the rewrites' own match, for a proxy.ts (next runs it before any rewrite): the handler url a markdown request
// goes to, or undefined when it isn't one. a proxy can't see public/, so a real .md file there matches too
export const mdRewrite = (request: Request): URL | undefined => {
  const url = new URL(request.url)
  const asked = isPage(url.pathname) && matches(request, url, rewrites.beforeFiles[1]!)
  const suffixed = suffixRegex.test(url.pathname) && matches(request, url, rewrites.afterFiles[1]!)
  if (!asked && !suffixed) return
  // a literalMd route's .md path goes as it is, so the handler can tell the page readme.md from a twin
  const page = isLiteral(url.pathname) ? url.pathname : mdPagePath(url.pathname)
  return new URL(handlerPath(page) + url.search, url)
}

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
const isLiteral = (pathname: string) =>
  /\.md$/i.test(pathname) && literalRoutes().some((route) => route.test(pathname))

export const isMdRequest = (request: Request) => mdRewrite(request) !== undefined

const LINK = 'rel="alternate"; type="text/markdown"'
const apiRoute = /^\/api(\/|$)/i

// the Link value md() sets on a page, for a proxy.ts that knows the page's public url when md()'s rules don't: a
// route whose public url isn't its folder's (one the proxy rewrites). undefined for anything that isn't a page
// request: api routes, next's internals, a markdown request, an RSC fetch. a Link the proxy sets replaces the one
// md() would, rather than adding to it
export const mdLink = (request: Request): string | undefined => {
  const url = new URL(request.url)
  if (!isPage(url.pathname) || apiRoute.test(url.pathname)) return
  if (isMdRequest(request) || !matches(request, url, { missing: notOursOrRsc })) return
  return `<${mdPath(url.pathname)}>; ${LINK}`
}

// a page's last param as one that never ends in .md, so a page's own twin (/docs/x.md on /docs/:slug+) doesn't
// match its rule and get pointed at /docs/x.md.md
const notTwin = (source: string) =>
  source.replace(
    /:(\w+)\+?$/,
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
          value: `<${mdPath(source.replace(/\+$/, ''))}>; ${LINK}`,
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
    // read once, when next loads its config; a page added during next dev shows up after a restart
    const pages = scanPages(root)
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
    }
  }

export const withMd = <C extends Config>(config: C, options?: MdOptions): C => md(options)(config)

// for generateMetadata: { alternates: mdAlternate('/blog/post') }
export const mdAlternate = (path: string) => ({ types: { 'text/markdown': mdPath(path) } })

export type MdHandlerOptions = {
  // where to fetch pages from; defaults to the request's own origin, or AFFORDANCES_MD_ORIGIN behind a proxy
  origin?: string
  timeout?: number
  maxBytes?: number
  // more headers on the handler's own fetch of the page, after the caller's forwarded ones, e.g.
  // x-vercel-protection-bypass for a protected preview
  headers?: HeadersInit | ((request: Request) => HeadersInit | Promise<HeadersInit>)
  // more markdown after the page's, e.g. an Affordances graph summary
  append?: (request: Request) => Promise<string | undefined> | string | undefined
}

const FORWARD = ['cookie', 'authorization', 'accept-language']

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
  async (request: Request, pagePath: string): Promise<Response> => {
    const { timeout = TIMEOUT, maxBytes = 6 * 1024 * 1024, append } = options
    if (request.headers.has(RENDER_HEADER)) return fail(508, 'Loop detected')

    const url = new URL(request.url)
    const target = pageUrl(request, options, pagePath + url.search)
    if (!target) return fail(400, 'Not a page on this site')
    // a client navigation reaches here when a proxy.ts rewrote it (next hides its RSC header from the proxy, then
    // puts it back): it wants the page's RSC payload, so it gets that, never markdown
    if (request.headers.get('rsc'))
      return (
        (await passPage(request, target, options)) ??
        fail(504, `${target.pathname} took longer than ${timeout}ms to render`)
      )
    const headers = new Headers()
    for (const name of FORWARD) {
      const value = request.headers.get(name)
      if (value) headers.set(name, value)
    }
    for (const [name, value] of await extraHeaders(request, options.headers))
      headers.set(name, value)
    headers.set('accept', 'text/html')
    headers.set(RENDER_HEADER, '1')

    let upstream: Response
    try {
      upstream = await fetch(target, {
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(timeout),
      })
    } catch {
      return fail(504, `${target.pathname} took longer than ${timeout}ms to render`)
    }

    // a same-origin redirect stays in markdown; one to another origin is passed on untouched, never followed
    if (upstream.status >= 300 && upstream.status < 400) {
      const location = upstream.headers.get('location')
      const next = location ? new URL(location, target) : undefined
      const to =
        next?.origin === target.origin ? `${mdPath(next.pathname)}${next.search}` : location
      return new Response(null, { status: upstream.status, headers: to ? { location: to } : {} })
    }

    // anything else (a file in public/, json) is passed on as it came. fetch has already decoded the body, so its
    // encoding and length no longer describe it
    if (!upstream.headers.get('content-type')?.includes('text/html')) {
      const passed = new Headers(upstream.headers)
      passed.delete('content-encoding')
      passed.delete('content-length')
      return new Response(upstream.body, { status: upstream.status, headers: passed })
    }
    if (Number(upstream.headers.get('content-length') ?? 0) > maxBytes)
      return fail(413, 'The page is too large to convert')
    const html = await upstream.text()
    if (html.length > maxBytes) return fail(413, 'The page is too large to convert')

    const result = htmlToMarkdown(html, { url: target.href })
    const extra = await append?.(request)
    const markdown = extra ? `${result.markdown}\n${extra.trim()}\n` : result.markdown

    // anything rendered with the caller's credentials, or that the page itself keeps private, stays private
    const cacheControl = upstream.headers.get('cache-control') ?? ''
    const personal =
      FORWARD.slice(0, 2).some((name) => headers.has(name)) ||
      /private|no-store/.test(cacheControl) ||
      upstream.headers.has('set-cookie')
    return respond(markdown, upstream.status, {
      'x-affordances-tokens': String(Math.ceil(markdown.length / 4)),
      ...(result.url && { link: `<${result.url}>; rel="canonical"` }),
      ...(personal
        ? { 'cache-control': 'private, no-store' }
        : cacheControl && { 'cache-control': cacheControl }),
    })
  }

// the markdown of the page a request is for. a .md path on a literalMd route is the page itself when that answers
// with anything but a 404 (converted for a markdown request, passed through for any other), and a twin when it 404s
export const createMdHandler = (options: MdHandlerOptions = {}) => {
  const convert = convertPage(options)
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    // a rewritten request keeps its original url in next (/blog/post.md, or /blog/post with Accept)
    const asked = url.pathname.replace(handlerPrefix, '') || '/'
    if (isLiteral(asked) && !request.headers.has(RENDER_HEADER)) {
      const markdown = present(request, url, accepts[0]!) && !request.headers.get('rsc')
      const found = markdown
        ? await convert(request, asked)
        : await literalPage(request, asked, options)
      if (found.status !== 404) return found
    }
    return convert(request, mdPagePath(url.pathname))
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

// app/api/affordances/md/[[...path]]/route.ts: export { GET } from '@affordances/md/next'
export const GET = createMdHandler()

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

// the public markdown of each page, rendered the way /page.md is, without the caller's cookies
const renderPages = async (
  request: Request,
  paths: string[],
  options: Omit<MdHandlerOptions, 'append'>,
) => {
  const render = createMdHandler(options)
  return Promise.all(
    paths.map(async (path) => {
      const response = await render(new Request(new URL(handlerPath(path), request.url)))
      const ok = response.ok && response.headers.get('content-type')?.startsWith('text/markdown')
      return { path, markdown: ok ? await response.text() : undefined }
    }),
  )
}

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
      'cache-control':
        headers.has('cookie') || headers.has('authorization')
          ? 'private, no-store'
          : 'public, max-age=0, s-maxage=3600',
    },
  })

// which pages to include: yours, given the index's routes without a dynamic segment, or those routes as they are
export type Pages = (request: Request, routes: string[]) => string[] | Promise<string[]>

export type LlmsFullOptions = Omit<MdHandlerOptions, 'append'> & {
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

export type LlmsTxtOptions = Omit<MdHandlerOptions, 'append'> & {
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

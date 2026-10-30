import { htmlToMarkdown } from '../convert/index.ts'

// where the rewrites send markdown requests; `affordances-md init` puts the route handler here
export const MD_PATH = '/api/affordances/md'
// set on the handler's own fetch of the page, so it never gets rewritten back to markdown
export const RENDER_HEADER = 'x-affordances-md-render'

export type Has = { type: 'header' | 'query'; key: string; value?: string }
export type Rewrite = { source: string; destination: string; has?: Has[]; missing?: Has[] }
export type Rewrites = { beforeFiles: Rewrite[]; afterFiles: Rewrite[]; fallback: Rewrite[] }
export type Config = { rewrites?: () => Promise<unknown> | unknown }

const accepts: Has[] = [{ type: 'header', key: 'accept', value: '.*text/markdown.*' }]
const notOurs: Has[] = [{ type: 'header', key: RENDER_HEADER }]
// pages: not api routes, not next's internals, not files with an extension
const page = '/:path((?!api/|_next/)(?!.*\\.[a-z0-9]+$).+)'

export const rewrites = {
  // Accept: text/markdown at the page's own url (browsers never ask for it, so a pattern match is enough)
  beforeFiles: [
    { source: '/', has: accepts, missing: notOurs, destination: MD_PATH },
    { source: page, has: accepts, missing: notOurs, destination: `${MD_PATH}/:path` },
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

// a next config wrapper, like createMDX(): md()(config), or withAffordances(config, { plugins: [md()] })
export const md =
  () =>
  <C extends Config>(config: C): C => ({
    ...config,
    rewrites: async () => {
      const user = normalize(await config.rewrites?.())
      // after whatever came first (e.g. Affordances' graph rewrites), so each keeps its own media type
      return {
        ...user,
        beforeFiles: [...user.beforeFiles, ...rewrites.beforeFiles],
        afterFiles: [...rewrites.afterFiles, ...user.afterFiles],
      }
    },
  })

export const withMd = <C extends Config>(config: C): C => md()(config)

// for generateMetadata: { alternates: mdAlternate('/blog/post') }
export const mdAlternate = (path: string) => ({
  types: { 'text/markdown': path === '/' ? '/index.md' : `${path.replace(/\/$/, '')}.md` },
})

export type MdHandlerOptions = {
  // where to fetch pages from; defaults to the request's own origin, or AFFORDANCES_MD_ORIGIN behind a proxy
  origin?: string
  timeout?: number
  maxBytes?: number
  // more markdown after the page's, e.g. an Affordances graph summary
  append?: (request: Request) => Promise<string | undefined> | string | undefined
}

const FORWARD = ['cookie', 'authorization', 'accept-language']

const respond = (body: string, status: number, headers: Record<string, string> = {}) =>
  new Response(body, {
    status,
    headers: { 'content-type': 'text/markdown; charset=utf-8', vary: 'Accept', ...headers },
  })

// renders the page as html the normal way (real RSC, Suspense, auth), then converts it
export const createMdHandler =
  ({ origin, timeout = 10_000, maxBytes = 6 * 1024 * 1024, append }: MdHandlerOptions = {}) =>
  async (request: Request): Promise<Response> => {
    const fail = (status: number, message: string) =>
      respond(`# ${message}\n`, status, { 'cache-control': 'private, no-store' })
    if (request.headers.has(RENDER_HEADER)) return fail(508, 'Loop detected')

    const url = new URL(request.url)
    // a rewritten request keeps its original url in next (/blog/post.md, or /blog/post with Accept), so map
    // every shape back to the page: /api/affordances/md/x, /x.md, /index.md → /x and /
    const path =
      (url.pathname.startsWith(MD_PATH) ? url.pathname.slice(MD_PATH.length) : url.pathname)
        .replace(/(^|\/)index\.md$/, '/')
        .replace(/\.md$/, '') || '/'
    const target = new URL(
      path + url.search,
      origin ?? process.env.AFFORDANCES_MD_ORIGIN ?? url.origin,
    )
    const headers = new Headers({ accept: 'text/html', [RENDER_HEADER]: '1' })
    for (const name of FORWARD) {
      const value = request.headers.get(name)
      if (value) headers.set(name, value)
    }

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
        next?.origin === target.origin
          ? `${next.pathname === '/' ? '/index' : next.pathname.replace(/\/$/, '')}.md${next.search}`
          : location
      return new Response(null, { status: upstream.status, headers: to ? { location: to } : {} })
    }

    if (!upstream.headers.get('content-type')?.includes('text/html'))
      return new Response(upstream.body, upstream)
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
      FORWARD.slice(0, 2).some((name) => request.headers.has(name)) ||
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

// app/api/affordances/md/[[...path]]/route.ts: export { GET } from '@affordances/md/next'
export const GET = createMdHandler()

// llms.txt and llms-full.txt. both read the site's own Affordances index when it serves one, for the site's
// name, each route's description, and the routes to list when you don't pass any

// the protocol's well-known path; @affordances/md works without the rest of Affordances, so it's spelled out
const SITE_INDEX = '/.well-known/affordances.json'

type SiteIndex = { name?: string; routes: { route: string; description?: string }[] }

const siteIndex = async (origin: string, timeout: number): Promise<SiteIndex | undefined> => {
  try {
    const response = await fetch(new URL(SITE_INDEX, origin), {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeout),
    })
    const body = response.ok ? ((await response.json()) as Partial<SiteIndex>) : undefined
    return Array.isArray(body?.routes) ? (body as SiteIndex) : undefined
  } catch {
    return undefined
  }
}

// routes without a dynamic segment are pages as they stand; /products/[slug] needs the app to name its pages
const staticRoutes = (index?: SiteIndex) =>
  index?.routes.map((r) => r.route).filter((route) => !route.includes('[')) ?? []

// the public markdown of each page, rendered the way /page.md is, without the caller's cookies
const renderPages = async (
  request: Request,
  paths: string[],
  options: Omit<MdHandlerOptions, 'append'>,
) => {
  const render = createMdHandler(options)
  return Promise.all(
    paths.map(async (path) => {
      const response = await render(
        new Request(new URL(`${MD_PATH}${path === '/' ? '' : path}`, request.url)),
      )
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

const text = (body: string) =>
  new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=0, s-maxage=3600',
    },
  })

// which pages to include: yours, given the index's routes without a dynamic segment, or those routes as they are
export type Pages = (request: Request, routes: string[]) => string[] | Promise<string[]>

export type LlmsFullOptions = Omit<MdHandlerOptions, 'append'> & {
  // the paths to include, in order; defaults to the site index's routes that need no params
  pages?: Pages
}

// app/llms-full.txt/route.ts: every page's markdown in one file, from the same render and converter as /x.md.
// rendered without the caller's cookies, so it's the public site; each page is headed `# Title (url)`
export const createLlmsFullHandler =
  ({ pages, ...options }: LlmsFullOptions = {}) =>
  async (request: Request): Promise<Response> => {
    const routes = staticRoutes(
      await siteIndex(origin(request, options), options.timeout ?? 10_000),
    )
    const paths = pages ? await pages(request, routes) : routes
    const parts = (await renderPages(request, paths, options)).map(({ path, markdown }) =>
      markdown
        ? markdown
            .replace(/^---\n[\s\S]*?\n---\n\n/, '')
            .replace(/^# (.+)$/m, `# $1 (${new URL(path, request.url).href})`)
            .trim()
        : '',
    )
    return text(`${parts.filter(Boolean).join('\n\n')}\n`)
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
  // the page lists, under `## ` headings; defaults to one Pages list of the site index's routes that need no params
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
  ({ title, summary, intro, sections, full = '/llms-full.txt', ...options }: LlmsTxtOptions = {}) =>
  async (request: Request): Promise<Response> => {
    const index = await siteIndex(origin(request, options), options.timeout ?? 10_000)
    const routes = staticRoutes(index)
    const lists = sections ? await sections(request, routes) : [{ title: 'Pages', pages: routes }]
    const abs = (path: string) => new URL(path, request.url).href
    const twin = (path: string) => abs(path === '/' ? '/index.md' : `${path.replace(/\/$/, '')}.md`)
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
    return text(`${[...head, ...body].filter(Boolean).join('\n\n')}\n`)
  }

// a string matched as itself in a RegExp
const literal = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

import { htmlToMarkdown } from '../convert/index.ts'

// where the rewrites send markdown requests; `afford-md init` puts the route handler here
export const MD_PATH = '/api/afford/md'
// set on the handler's own fetch of the page, so it never gets rewritten back to markdown
export const RENDER_HEADER = 'x-afford-md-render'

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

// a next config wrapper, like createMDX(): md()(config), or withAfford(config, { plugins: [md()] })
export const md =
  () =>
  <C extends Config>(config: C): C => ({
    ...config,
    rewrites: async () => {
      const user = normalize(await config.rewrites?.())
      // after whatever came first (e.g. afford's graph rewrites), so each keeps its own media type
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
  // where to fetch pages from; defaults to the request's own origin, or AFFORD_MD_ORIGIN behind a proxy
  origin?: string
  timeout?: number
  maxBytes?: number
  // more markdown after the page's, e.g. an Afford graph summary
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
    // every shape back to the page: /api/afford/md/x, /x.md, /index.md → /x and /
    const path =
      (url.pathname.startsWith(MD_PATH) ? url.pathname.slice(MD_PATH.length) : url.pathname)
        .replace(/(^|\/)index\.md$/, '/')
        .replace(/\.md$/, '') || '/'
    const target = new URL(path + url.search, origin ?? process.env.AFFORD_MD_ORIGIN ?? url.origin)
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
      'x-afford-tokens': String(Math.ceil(markdown.length / 4)),
      ...(result.url && { link: `<${result.url}>; rel="canonical"` }),
      ...(personal
        ? { 'cache-control': 'private, no-store' }
        : cacheControl && { 'cache-control': cacheControl }),
    })
  }

// app/api/afford/md/[[...path]]/route.ts: export { GET } from '@afford/md/next'
export const GET = createMdHandler()

export type LlmsFullOptions = Omit<MdHandlerOptions, 'append'> & {
  // the paths to include, in order, e.g. from your sitemap or content source
  pages: (request: Request) => string[] | Promise<string[]>
}

// app/llms-full.txt/route.ts: every page's markdown in one file, from the same render and converter as /x.md.
// rendered without the caller's cookies, so it's the public site; each page is headed `# Title (url)`
export const createLlmsFullHandler =
  ({ pages, ...options }: LlmsFullOptions) =>
  async (request: Request): Promise<Response> => {
    const render = createMdHandler(options)
    const parts = await Promise.all(
      (await pages(request)).map(async (path) => {
        const response = await render(
          new Request(new URL(`${MD_PATH}${path === '/' ? '' : path}`, request.url)),
        )
        if (!response.ok || !response.headers.get('content-type')?.startsWith('text/markdown'))
          return ''
        const url = new URL(path, request.url).href
        return (await response.text())
          .replace(/^---\n[\s\S]*?\n---\n\n/, '')
          .replace(/^# (.+)$/m, `# $1 (${url})`)
          .trim()
      }),
    )
    return new Response(`${parts.filter(Boolean).join('\n\n')}\n`, {
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'public, max-age=0, s-maxage=3600',
      },
    })
  }

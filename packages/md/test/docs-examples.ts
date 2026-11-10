// the docs' and README's examples for md()'s server side, type-checked by tsc (this package's tsconfig includes
// test/), so an example that stops compiling fails `vlt run typecheck`. each is written as its page shows it
import type { NextConfig } from 'next'
import { type NextFetchEvent, NextResponse, type NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { unauthorized } from 'next/navigation'
import { cacheLife, cacheTag, revalidateTag } from 'next/cache'
import {
  createMdHandler,
  type Markdown,
  type MarkdownArgs,
  type MarkdownModule,
  md as mdPlugin,
  type Slots,
  withMd,
} from '../src/next/index.ts'
import { mdProxy } from '../src/next/proxy.ts'

const nextConfig = {}

// setup.mdx and the README: init's one-line route, replaced to set its options
export const GET = createMdHandler({ maxBytes: 32 * 1024 * 1024, timeout: 20_000 })

// a next.config.ts typed as Next's own template types it, i18n and basePath included: withMd and md() take it as it is
const typedConfig: NextConfig = {
  basePath: '/docs',
  i18n: { locales: ['en', 'fr'], defaultLocale: 'en' },
}
export const typedWithMd: NextConfig = withMd(typedConfig)
export const typedMd: NextConfig = mdPlugin()(typedConfig)

// setup.mdx, "Public URLs your proxy maps onto routes"
export const aliased = withMd(nextConfig, {
  aliases: {
    '/package/@:scope/:name/:rest*': '/package/@:scope%2F:name/:rest*',
  },
})

// setup.mdx, "With a proxy.ts": the gate-first recipe
export const gated = (request: NextRequest) => {
  const md = mdProxy(request)
  // your gates, first, on md.page: /dashboard.md and /dashboard with Accept are both /dashboard
  if (md.page.pathname.startsWith('/dashboard') && !request.cookies.has('session'))
    return md.redirect(new URL('/sign-in', request.url))
  return md.next()
}

// the app's own helpers the next two examples import from './site'
declare const collapse: (url: URL) => URL | undefined
declare const flagOn: (request: NextRequest) => boolean
declare const isFlagged: (pathname: string) => boolean

// setup.mdx, "With a proxy.ts": a proxy that also rewrites
export const rewriting = (request: NextRequest) => {
  const md = mdProxy(request)
  if (isFlagged(md.page.pathname) && !flagOn(request)) return md.redirect(new URL('/', request.url))
  if (md.markdown) return md.next()
  const url = collapse(request.nextUrl)
  return url ? NextResponse.rewrite(url) : NextResponse.next()
}

// the third-party middleware the adopt example imports from './auth'
declare const authMiddleware: (
  request: NextRequest,
  event: NextFetchEvent,
) => Promise<Response | undefined>

// setup.mdx, "With a proxy.ts": a third-party middleware's answer, adopted
export const adopting = async (request: NextRequest, event: NextFetchEvent) => {
  const md = mdProxy(request)
  const answer = await authMiddleware(md.request, event)
  return answer ? md.adopt(answer) : md.next()
}

// setup.mdx, "Link from the proxy"
export const linked = (request: NextRequest) => {
  const md = mdProxy(request)
  if (md.markdown) return md.next()

  const url = collapse(request.nextUrl)
  if (!url) return NextResponse.next()
  const response = NextResponse.rewrite(url)
  if (md.link) response.headers.set('Link', md.link)
  return response
}

// the app's own fetchers the markdown-file.mdx examples import
declare const getPackage: (
  registry: string,
  name: string,
) => Promise<{ name: string; description: string; readme: string }>
declare const api: {
  orders: { get: (id: string, auth: { session: string }) => Promise<{ number: string }> }
  billing: { get: (name: string, auth: { session: string }) => Promise<{ name: string }> }
}

// markdown-file.mdx, the first example
export async function registryMarkdown({
  params,
}: MarkdownArgs<'/registry/[registry]/npm/package/[pkg]'>) {
  const pkg = await getPackage(params.registry, decodeURIComponent(params.pkg))
  return {
    title: pkg.name,
    description: pkg.description,
    markdown: `# ${pkg.name}\n\n${pkg.description}\n\n${pkg.readme}`,
  }
}

// markdown-file.mdx, "Authorization"
export async function orderMarkdown({ params }: MarkdownArgs<'/orders/[id]'>) {
  const session = (await cookies()).get('session')?.value
  if (!session) unauthorized()
  const order = await api.orders.get(params.id, { session }) // the API checks it's theirs
  return `# Order ${order.number}\n\n…`
}

declare const getRegistryPackage: (name: string) => Promise<{ readme: string }>

// markdown-file.mdx, "Slots"
export const slots = {
  readme: async ({ params }) => (await getRegistryPackage(decodeURIComponent(params.pkg))).readme,
} satisfies Slots<'/package/[pkg]'>

// markdown-file.mdx, "Slots": a fill for someone's own data authorizes it itself
export const authorizedSlots = {
  billing: async ({ params }) => {
    const session = (await cookies()).get('session')?.value
    if (!session) return undefined
    const plan = await api.billing.get(decodeURIComponent(params.pkg), { session }) // the API checks it's theirs
    return `**Plan:** ${plan.name}`
  },
} satisfies Slots<'/package/[pkg]'>

// caching.mdx, "Caching public Markdown": one line next to each kind of route
declare const readme: (pkg: string) => Promise<string>
declare const pkgMarkdown: (pkg: string) => Promise<string>
export const slotRoute = {
  slots: { readme: async ({ params }) => readme(params.pkg) } satisfies Slots<'/package/[pkg]'>,
  publicCache: 'hours',
} satisfies MarkdownModule<'/package/[pkg]'>
export const defaultRoute = {
  default: (async ({ params }) => pkgMarkdown(params.pkg)) satisfies Markdown<'/package/[pkg]'>,
  publicCache: { revalidate: 300, expire: 86_400 },
} satisfies MarkdownModule<'/package/[pkg]'>
export const convertedRoute = { publicCache: 'days' } satisfies MarkdownModule<'/package/[pkg]'>

// caching.mdx: 'use cache' in a fill, refreshed by revalidateTag
declare const fetchReadme: (pkg: string) => Promise<string>
async function cachedReadme(pkg: string) {
  'use cache'
  cacheLife('hours')
  cacheTag(`pkg:${pkg}`)
  return fetchReadme(pkg)
}
export const cachedSlots = {
  readme: ({ params }) => cachedReadme(params.pkg),
} satisfies Slots<'/package/[pkg]'>
export const published = (name: string) => revalidateTag(`pkg:${name}`, 'max')

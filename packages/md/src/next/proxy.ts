// @affordances/md/next/proxy: what a proxy.ts needs, the rewrites' own match and the Link value, without the handler.
// importing it rather than @affordances/md/next keeps the converter and every markdown.ts out of the proxy's bundle
// with its .js: next.config loads this entry in plain node, whose esm can't resolve 'next/server' (next has no exports
// map). bundlers resolve both to the same file
import { NextRequest, NextResponse } from 'next/server.js'
import { mdPath } from '../path.ts'
import {
  ADOPT_HEADER,
  aliasPath,
  apiRoute,
  handlerPath,
  handlerPrefix,
  isLiteral,
  isPage,
  LINK,
  matches,
  notOursOrRsc,
  rewrites,
  suffixRegex,
  twinLocation,
} from './rules.ts'

export { MD_PATH, RENDER_HEADER, rewrites, type Has, type Rewrite, type Rewrites } from './rules.ts'
export { mdPath }

// the page a markdown request is for, from every shape next hands the handler: /api/affordances/md/x, /x.md,
// /index.md, and /x asked for with Accept → /x and /. case-insensitive, like next's own matching
export const mdPagePath = (pathname: string) =>
  pathname
    .replace(handlerPrefix, '')
    .replace(/(^|\/)index\.md$/i, '/')
    .replace(/\.md$/i, '') || '/'

// the rewrites' own match, for a proxy.ts (next runs it before any rewrite): the handler url a markdown request
// goes to, or undefined when it isn't one. a proxy can't see public/, so a real .md file there matches too
// the rewrites' own match, once: for a markdown request, the path of the page it's for, else undefined. a literalMd
// route's .md path is kept whole, so the handler can tell the page readme.md from a twin
const markdownPage = (request: Request, url: URL) => {
  const asked = isPage(url.pathname) && matches(request, url, rewrites.beforeFiles[1]!)
  const suffixed = suffixRegex.test(url.pathname) && matches(request, url, rewrites.afterFiles[1]!)
  if (!asked && !suffixed) return undefined
  return isLiteral(url.pathname) ? url.pathname : mdPagePath(url.pathname)
}
const handlerUrl = (page: string, url: URL) => new URL(handlerPath(page) + url.search, url)

export const mdRewrite = (request: Request): URL | undefined => {
  const url = new URL(request.url)
  const page = markdownPage(request, url)
  return page === undefined ? undefined : handlerUrl(page, url)
}

export const isMdRequest = (request: Request) => mdRewrite(request) !== undefined

// the app/ route url a public url renders, through md({ aliases }), as the handler resolves it: the pathname itself
// when no alias matches. for a proxy.ts that maps the same urls and wants one source of truth
export const mdAliasPath = (pathname: string): string => aliasPath(pathname) ?? pathname

// the Link value md() sets on a page, for a proxy.ts that knows the page's public url when md()'s rules don't: a
// route whose public url isn't its folder's (one the proxy rewrites). undefined for anything that isn't a page
// request: api routes, next's internals, a markdown request, an RSC fetch. a Link the proxy sets replaces the one
// md() would, rather than adding to it
export const mdLink = (request: Request): string | undefined => {
  const url = new URL(request.url)
  return pageLink(request, url, () => markdownPage(request, url) !== undefined)
}
// the cheap checks first: a markdown request is a page url too, so the full match runs last
const pageLink = (request: Request, url: URL, markdown: () => boolean) => {
  if (!isPage(url.pathname) || apiRoute.test(url.pathname)) return
  if (!matches(request, url, { missing: notOursOrRsc }) || markdown()) return
  // resolved, so a path that starts with //host (/.//evil.test/x is one) is never handed out as another site's link
  const twin = new URL(mdPath(url.pathname), url)
  if (twin.origin !== url.origin) return
  return `<${twin.pathname}>; ${LINK}`
}

// what a proxy.ts does with a request, markdown or html alike: gate the page it's for, then let it through
export type MdProxy = {
  // the page the request is for, whether it asks for html or markdown: /compare.md and /compare with Accept are
  // /compare, /index.md is /, a literalMd page keeps its own .md. its search is the request's. run every gate on this
  page: URL
  // whether the request is for the page's markdown
  markdown: boolean
  // the page as a NextRequest, with the request's method, headers and cookies: for a gate that takes a request
  // (a middleware's matcher), so it gates the page, never the .md url
  request: NextRequest
  // NextResponse.redirect, except that a markdown request sent to a page on this site goes to that page's .md, so an
  // agent stays in markdown. another origin is a plain redirect
  redirect: (url: string | URL, init?: number | ResponseInit) => NextResponse
  // NextResponse.rewrite, except that a markdown request gets the destination page's markdown, with init's status
  rewrite: (...args: Parameters<typeof NextResponse.rewrite>) => NextResponse
  // a response another middleware (a gate you didn't write) gave, made right for a markdown request: its redirect to
  // a page on this site goes to that page's .md, its rewrite to a page on this site gives that page's markdown with its
  // status, and each is private, no-store, varying on Accept. another origin, and any request that isn't for markdown,
  // get the response as it is
  adopt: (response: Response) => Response
  // let the request through: a markdown request to the markdown handler, any other with NextResponse.next(init)
  next: (init?: Parameters<typeof NextResponse.next>[0]) => NextResponse
  // the Link value for a page request, for a site whose proxy maps urls onto routes without md({ aliases }); undefined
  // for anything else, markdown requests included
  link: string | undefined
}

// a gate's answer to a request for markdown depends on who asked: never cached as the html url's answer, or as anyone
// else's
const personal = <R extends Response>(response: R) => {
  response.headers.set('vary', 'Accept')
  response.headers.set('cache-control', 'private, no-store')
  return response
}

// the request headers a middleware's response set for the page, as next encodes them (x-middleware-override-headers
// names them, x-middleware-request-<name> holds each): the exact set the page gets, or undefined when it set none
const overridden = (response: Response) => {
  const names = response.headers.get('x-middleware-override-headers')
  if (names === null) return undefined
  const headers = new Headers()
  for (const name of names.split(',').filter(Boolean)) {
    const value = response.headers.get(`x-middleware-request-${name}`)
    if (value !== null) headers.set(name, value)
  }
  return headers
}

// proxy.ts: const md = mdProxy(request), then every gate on md.page, then md.next()
export const mdProxy = (request: Request): MdProxy => {
  const url = new URL(request.url)
  const path = markdownPage(request, url)
  const handler = path === undefined ? undefined : handlerUrl(path, url)
  const page = new URL(url)
  if (path !== undefined) page.pathname = path
  const redirect: MdProxy['redirect'] = (to, init) => {
    const target = new URL(to, url)
    const twin = handler && twinLocation(target, url)
    const response = NextResponse.redirect(twin ? new URL(twin, url) : target, init)
    return handler ? personal(response) : response
  }
  // a page on this site's markdown, to the gate's status, through the handler: the page and status ride on a request
  // header only this rewrite sets, with md()'s per-build token, so a caller who sends it gets nothing
  // the gate's request headers when it set its own (NextResponse.rewrite or next with request.headers), which the page
  // then gets in place of the client's: identity, a tenant, a refreshed session
  const adopted = (target: URL, status: number, base: Headers = request.headers) => {
    // spelled out: next inlines process.env.NAME, never process.env[name]
    const token = process.env.AFFORDANCES_MD_ADOPT
    // without md()'s token the handler can't tell the gate's answer from a caller's, so it never goes out unverified
    if (!token) {
      if (process.env.NODE_ENV !== 'production')
        console.error(
          "[affordances-md] mdProxy can't hand a gate's rewrite to the Markdown route: md()'s token isn't in this build. Add md() (or withMd) to next.config.",
        )
      return personal(new NextResponse("# The page couldn't be gated\n", { status: 500 }))
    }
    const headers = new Headers(base)
    headers.set(ADOPT_HEADER, `${token};${status};${target.pathname}${target.search}`)
    const to = handlerUrl(
      isLiteral(target.pathname) ? target.pathname : mdPagePath(target.pathname),
      target,
    )
    return personal(NextResponse.rewrite(to, { request: { headers } }))
  }
  const rewrite: MdProxy['rewrite'] = (destination, init) => {
    const target = new URL(destination, url)
    if (!handler || target.origin !== url.origin) return NextResponse.rewrite(target, init)
    const own = init?.request?.headers
    return adopted(target, init?.status ?? 200, own ? new Headers(own) : request.headers)
  }
  const adopt: MdProxy['adopt'] = (response) => {
    if (!handler) return response
    // the gate's own headers (a cookie it set) go along; next's own say what the gate did, and are read here
    const along = (into: NextResponse) => {
      for (const [name, value] of response.headers)
        if (!/^(x-middleware-|location$|content-length$)/i.test(name))
          if (name === 'set-cookie') into.headers.append(name, value)
          else into.headers.set(name, value)
      return personal(into)
    }
    const location = response.headers.get('location')
    if (response.status >= 300 && response.status < 400 && location) {
      const target = new URL(location, url)
      return target.origin === url.origin ? along(redirect(target, response.status)) : response
    }
    const gated = overridden(response)
    const rewritten = response.headers.get('x-middleware-rewrite')
    if (rewritten) {
      const target = new URL(rewritten, url)
      return target.origin === url.origin
        ? along(adopted(target, response.status, gated ?? request.headers))
        : response
    }
    // let through (NextResponse.next()), so on to this page's markdown with the headers the gate set; anything else is
    // the gate's own answer
    if (response.headers.get('x-middleware-next'))
      return along(NextResponse.rewrite(handler, gated && { request: { headers: gated } }))
    return personal(response)
  }
  let built: NextRequest | undefined
  return {
    page,
    markdown: handler !== undefined,
    link: handler ? undefined : pageLink(request, url, () => false),
    // md's own NextRequest, from the request's parts: next's own can't be another Request's input in its runtime. made
    // when it's first read, since most gates take the url
    get request() {
      return (built ??= new NextRequest(page, { method: request.method, headers: request.headers }))
    },
    redirect,
    rewrite,
    adopt,
    next: (init) => (handler ? NextResponse.rewrite(handler, init) : NextResponse.next(init)),
  }
}

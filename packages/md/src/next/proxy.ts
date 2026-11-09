// @affordances/md/next/proxy: what a proxy.ts needs, the rewrites' own match and the Link value, without the handler.
// importing it rather than @affordances/md/next keeps the converter and every markdown.ts out of the proxy's bundle
// with its .js: next.config loads this entry in plain node, whose esm can't resolve 'next/server' (next has no exports
// map). bundlers resolve both to the same file
import { NextResponse } from 'next/server.js'
import { mdPath } from '../path.ts'
import {
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
  // NextResponse.redirect, except that a markdown request sent to a page on this site goes to that page's .md, so an
  // agent stays in markdown. another origin is a plain redirect
  redirect: (url: string | URL, init?: number | ResponseInit) => NextResponse
  // let the request through: a markdown request to the markdown handler, any other with NextResponse.next(init)
  next: (init?: Parameters<typeof NextResponse.next>[0]) => NextResponse
  // the Link value for a page request, for a site whose proxy maps urls onto routes without md({ aliases }); undefined
  // for anything else, markdown requests included
  link: string | undefined
}

// proxy.ts: const md = mdProxy(request), then every gate on md.page, then md.next()
export const mdProxy = (request: Request): MdProxy => {
  const url = new URL(request.url)
  const path = markdownPage(request, url)
  const handler = path === undefined ? undefined : handlerUrl(path, url)
  const page = new URL(url)
  if (path !== undefined) page.pathname = path
  return {
    page,
    markdown: handler !== undefined,
    link: handler ? undefined : pageLink(request, url, () => false),
    redirect: (to, init) => {
      const target = new URL(to, url)
      const twin = handler && twinLocation(target, url)
      const response = NextResponse.redirect(twin ? new URL(twin, url) : target, init)
      // it answers a request for markdown, and it's a gate's answer, so it depends on who asked: never cached as the
      // html url's answer, or as anyone else's
      if (handler) {
        response.headers.set('vary', 'Accept')
        response.headers.set('cache-control', 'private, no-store')
      }
      return response
    },
    next: (init) => (handler ? NextResponse.rewrite(handler, init) : NextResponse.next(init)),
  }
}

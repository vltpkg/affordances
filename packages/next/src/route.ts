import { createHandler, type HandlerOptions, type Manifest } from '@affordances/core'
import { API_PATH, MANIFEST_PATH, PROJECTION_BASE } from './constants.ts'

// next's redirect() throws an error whose digest is NEXT_REDIRECT;<type>;<url>;<status>;
const redirectFrom = (error: unknown) => {
  const digest = (error as { digest?: unknown } | null)?.digest
  if (typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT;')) return digest.split(';')[2]
}

// the app's manifest, through the alias withAffordances adds; imported on the first request, so a handler
// given its own manifest (tests, other setups) never needs the alias
const appManifest = async (): Promise<Manifest> => {
  const { manifest } = await import('@affordances/next/manifest')
  if (!manifest)
    throw new Error(
      'No Affordances manifest: wrap next.config with withAffordances from @affordances/next/config',
    )
  return manifest
}

// the app's compiled capability manifest, through the alias withAffordances adds to .affordances/capabilities.ts
type Compiled = { canonical: string; digest: string } | null
const appCompiled = async (): Promise<Compiled> =>
  (await import('@affordances/next/compiled')).capabilities

export type RouteHandlerOptions = Omit<HandlerOptions, 'manifest' | 'basePath' | 'capabilities'> & {
  // defaults to the app's .affordances/manifest.ts
  manifest?: Manifest
  /** @experimental The compiled capability manifest: defaults to the app's .affordances/capabilities.ts */
  compiled?: Compiled
  /**
   * @experimental Whether the capability manifest is public (RFC 0004 §2): 'private' serves it to no one and leaves the
   * site index without it, while views and execution work as before. Defaults to withAffordances' setting, else public
   */
  visibility?: 'public' | 'private'
  /** @experimental Version 1's base: defaults to withAffordances' setting, else /api/projection */
  base?: string
}

// app/api/affordances/graph/[[...path]]/route.ts: export { GET, POST } from '@affordances/next/route', or
// call this with options and export the handler as both
// RFC 9110 §13.1.2: If-None-Match holds * or a list of entity tags, each compared weakly, so a W/ prefix is ignored
const noneMatch = (header: string | null, etag: string) =>
  header !== null &&
  (header.trim() === '*' ||
    header.split(',').some((tag) => tag.trim().replace(/^W\//, '') === etag))

export const createRouteHandler = (options: RouteHandlerOptions = {}) => {
  const { manifest, compiled, visibility, base, ...rest } = options
  // per build: withAffordances bridges its options as env, which Next inlines (read literally, so it can)
  const visible = (visibility ?? process.env.AFFORDANCES_MANIFEST) !== 'private'
  const projection = base ?? process.env.AFFORDANCES_PROJECTION_BASE ?? PROJECTION_BASE
  let handler:
    | Promise<{ v0: (request: Request) => Promise<Response>; published: Compiled }>
    | undefined
  return async (request: Request) => {
    handler ??= Promise.all([
      manifest ? Promise.resolve(manifest) : appManifest(),
      // a handler given its own manifest (tests, other setups) never needs an alias: then there's no compiled manifest
      // unless it's given too
      compiled !== undefined
        ? Promise.resolve(compiled)
        : manifest
          ? Promise.resolve(null)
          : appCompiled(),
    ]).then(([m, c]) => {
      // only a site with capabilities that publishes its manifest names version 1; otherwise the index is v0's alone
      const published = visible ? c : null
      return {
        v0: createHandler({
          redirectFrom,
          ...rest,
          manifest: m,
          basePath: API_PATH,
          ...(published && { capabilities: { manifest: MANIFEST_PATH, base: projection } }),
        }),
        published,
      }
    })
    const { v0, published } = await handler
    // GET {manifest}: the canonical IR, ETag its digest, cacheable by anyone, since it holds no principal's data. A
    // private or absent manifest falls through, to the same 404 as any path that has no graph
    // behind withAffordances' rewrite a route handler's request keeps the url it was asked for, so the path is matched
    // with API_PATH stripped when it's there, as core's handler does for the index
    const { pathname } = new URL(request.url)
    const path = pathname.startsWith(API_PATH) ? pathname.slice(API_PATH.length) || '/' : pathname
    if (published && request.method === 'GET' && path === MANIFEST_PATH) {
      const etag = `"${published.digest}"`
      const headers = {
        'content-type': 'application/json',
        etag,
        'cache-control': 'public, max-age=300',
      }
      if (noneMatch(request.headers.get('if-none-match'), etag))
        return new Response(null, { status: 304, headers })
      return new Response(published.canonical, { headers })
    }
    return v0(request)
  }
}

export const GET = createRouteHandler()
export const POST = GET

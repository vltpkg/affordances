import { createHandler, type HandlerOptions, type Manifest } from '@affordances/core'
import { API_PATH } from './constants.ts'

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

export type RouteHandlerOptions = Omit<HandlerOptions, 'manifest' | 'basePath'> & {
  // defaults to the app's .affordances/manifest.ts
  manifest?: Manifest
}

// app/api/affordances/graph/[[...path]]/route.ts: export { GET, POST } from '@affordances/next/route', or
// call this with options and export the handler as both
export const createRouteHandler = (options: RouteHandlerOptions = {}) => {
  const { manifest, ...rest } = options
  let handler: Promise<(request: Request) => Promise<Response>> | undefined
  return async (request: Request) => {
    handler ??= (manifest ? Promise.resolve(manifest) : appManifest()).then((m) =>
      createHandler({ redirectFrom, ...rest, manifest: m, basePath: API_PATH }),
    )
    return (await handler)(request)
  }
}

export const GET = createRouteHandler()
export const POST = GET

import { createHandler, type HandlerOptions, type Manifest } from '@afford/core'
import { API_PATH } from './constants.ts'

// next's redirect() throws an error whose digest is NEXT_REDIRECT;<type>;<url>;<status>;
const redirectFrom = (error: unknown) => {
  const digest = (error as { digest?: unknown } | null)?.digest
  if (typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT;')) return digest.split(';')[2]
}

// app/api/afford/graph/[[...path]]/route.ts: export { handler as GET, handler as POST }
export const createRouteHandler = (
  manifest: Manifest,
  options: Omit<HandlerOptions, 'manifest' | 'basePath'> = {},
) => createHandler({ redirectFrom, ...options, manifest, basePath: API_PATH })

import { createRouteHandler } from '@afford/next/route'
import { manifest } from '../../../../../.afford/manifest'

const handler = createRouteHandler(manifest)

export { handler as GET, handler as POST }

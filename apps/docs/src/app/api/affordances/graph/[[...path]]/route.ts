import { createRouteHandler } from '@affordances/next/route'
import { manifest } from '../../../../../../.affordances/manifest'

const handler = createRouteHandler(manifest)

export { handler as GET, handler as POST }

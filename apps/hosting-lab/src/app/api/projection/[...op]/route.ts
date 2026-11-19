import { countingErrors } from '@/lib/server-errors'
import * as serve from '@/lib/serve'

// RFC 0004 §2's protocol 1 under /api/projection: GET /view and /inspect, POST /expand, /check and /execute
export const GET = countingErrors('/api/projection/[...op]', (request: Request) =>
  serve.GET(request),
)
export const POST = countingErrors('/api/projection/[...op]', (request: Request) =>
  serve.POST(request),
)

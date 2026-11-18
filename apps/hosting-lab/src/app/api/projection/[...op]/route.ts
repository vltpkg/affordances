import { serveExecute, serveView } from '@/lib/serve'

// RFC 0004 §2's protocol 1 under /api/projection: GET /view and /inspect, POST /expand, /check and /execute
export const GET = (request: Request) => serveView(request)
export const POST = (request: Request) => serveExecute(request)

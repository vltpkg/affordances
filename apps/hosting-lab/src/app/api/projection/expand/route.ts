import { serveExpand } from '@/lib/serve'

// more of the caller's projection, as a view: { from, along, budget?, policy?, start?, seen?, task? }
export const POST = (request: Request) => serveExpand(request)

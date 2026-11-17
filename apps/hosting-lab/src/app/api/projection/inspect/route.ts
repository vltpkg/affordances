import { serveInspect } from '@/lib/serve'

// one offer in the caller's projection, with its capability's definition: ?offer=, and the projection's parameters
export const GET = (request: Request) => serveInspect(request)

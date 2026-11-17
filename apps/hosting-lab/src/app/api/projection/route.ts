import { serveView } from '@/lib/serve'

// a view of the projection for the caller (RFC 0002 §6.2): ?policy=, ?start=type:key, ?seen=, ?task=
export const GET = (request: Request) => serveView(request)

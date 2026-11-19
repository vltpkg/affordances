import { countingErrors } from '@/lib/server-errors'
import * as serve from '@/lib/serve'

// a view of the projection for the caller (RFC 0002 §6.2): ?policy=, ?start=type:key, ?seen=, ?task=
export const GET = countingErrors('/api/projection', (request: Request) => serve.GET(request))

import { serveExecute } from '@/lib/serve'

// run an offer in the caller's projection, every check first: { offer, input?, approval?, ifRevision? }
export const POST = (request: Request) => serveExecute(request)

import { createLlmsFullHandler } from '@affordances/md/next'

// a literal route's page, read at its own url with Accept
export const GET = createLlmsFullHandler({ pages: () => ['/ok', '/notes/a'] })

import { createLlmsFullHandler } from '@affordances/md/next'

// a page whose boundary caught an error is left out, as a private page is: a retry won't change it
export const GET = createLlmsFullHandler({ pages: () => ['/ok', '/boom'] })

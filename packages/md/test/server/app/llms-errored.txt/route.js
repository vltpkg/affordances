import { createLlmsFullHandler } from '@affordances/md/next'

// a page whose boundary caught an error is missing a part, so the file isn't whole
export const GET = createLlmsFullHandler({ pages: () => ['/ok', '/boom'] })

import { createLlmsFullHandler } from '@affordances/md/next'

// pages that render a part in the browser by design are whole
export const GET = createLlmsFullHandler({ pages: () => ['/ok', '/csr', '/sp'] })

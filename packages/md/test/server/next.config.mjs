import { withMd } from '@affordances/md/next'

export default withMd({ experimental: { authInterrupts: true } }, { literalMd: ['/notes/:file'] })

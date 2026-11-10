import { withMd } from '@affordances/md/next'

export default withMd({
  cacheComponents: true,
  partialPrefetching: true,
  cacheLife: { weekly: { revalidate: 604_800, expire: 1_209_600 } },
})

// the docs' and README's examples for md()'s server side, type-checked by tsc (this package's tsconfig includes
// test/), so an example that stops compiling fails `vlt run typecheck`. each is written as its page shows it
import { withMd } from '../src/next/index.ts'

const nextConfig = {}

// setup.mdx, "Public URLs your proxy maps onto routes"
export const aliased = withMd(nextConfig, {
  aliases: {
    '/package/@:scope/:name/:rest*': '/package/@:scope%2F:name/:rest*',
  },
})

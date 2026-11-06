// the app's pages, found at build time by md() so llms.txt and the Link header work without the Affordances index.
// node:fs is loaded only when md() runs in next.config, so the route handlers that share this entry stay edge-safe

// passed from next.config to the handlers through next's `env`, which inlines it at build time
export const ROUTES_ENV = 'AFFORDANCES_MD_ROUTES'

const PAGE = /^page\.(tsx|ts|jsx|js|mdx|md)$/

// app/ or src/app/ under the project root
export const findAppDir = (root: string) => {
  const fs = process.getBuiltinModule?.('node:fs')
  const path = process.getBuiltinModule?.('node:path')
  return ['app', 'src/app']
    .map((dir) => path?.join(root, dir))
    .find((dir) => dir && fs?.existsSync(dir))
}

// app/(shop)/products/[slug]/page.tsx → /products/[slug]. skipped: _private folders, @slots (they render into
// their parent's url), intercepting routes, and api/, which the markdown rewrites never reach
export const scanPages = (root: string): string[] => {
  const fs = process.getBuiltinModule?.('node:fs')
  const path = process.getBuiltinModule?.('node:path')
  const app = findAppDir(root)
  if (!fs || !path || !app) {
    // the Link headers and the default llms lists come from here; say why they'd be empty
    console.warn(
      `[affordances-md] ${fs ? `no app/ directory in ${root}; pass md({ root })` : 'reading app/ needs Node 20.16 or later'}, so pages get no Link header and llms.txt lists none by default`,
    )
    return []
  }
  const pages: string[] = []
  const walk = (dir: string, segments: string[]) => {
    const children = fs.readdirSync(dir, { withFileTypes: true })
    if (children.some((child) => child.isFile() && PAGE.test(child.name)))
      pages.push(`/${segments.join('/')}`)
    for (const child of children) {
      const name = child.name
      if (!child.isDirectory() || /^[_@]|^\(\.|^node_modules$/.test(name)) continue
      if (!segments.length && name === 'api') continue
      walk(path.join(dir, name), /^\(.*\)$/.test(name) ? segments : [...segments, name])
    }
  }
  walk(app, [])
  return pages.toSorted((a, b) => a.localeCompare(b))
}

// the routes md() found, or none when it didn't run (withMd left out, or a test)
export const builtPages = (): string[] => {
  try {
    // spelled out: next inlines process.env.NAME, never process.env[name]
    const pages: unknown = JSON.parse(process.env.AFFORDANCES_MD_ROUTES ?? '[]')
    return Array.isArray(pages) ? pages.filter((page) => typeof page === 'string') : []
  } catch {
    return []
  }
}

// path-to-regexp names are word characters: [product-id] → :productid
const param = (name: string) => name.replace(/\W/g, '')

// /products/[slug] → /products/:slug, the path-to-regexp form next's headers() matches
export const toSource = (route: string) =>
  route
    .replace(/\[\[\.\.\.([^\]]+)\]\]/g, (_, name: string) => `:${param(name)}*`)
    .replace(/\[\.\.\.([^\]]+)\]/g, (_, name: string) => `:${param(name)}+`)
    .replace(/\[([^\]]+)\]/g, (_, name: string) => `:${param(name)}`)

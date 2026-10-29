import { watch } from 'node:fs'
import type { NextConfig } from 'next'
import { MEDIA_TYPE, WELL_KNOWN_PATH } from '@afford/protocol'
import { findAppDir, generate } from './codegen.ts'
import { API_PATH } from './constants.ts'

export { API_PATH }

type Rewrite = {
  source: string
  destination: string
  has?: { type: 'header' | 'query'; key: string; value?: string }[]
}
type Rewrites = { beforeFiles: Rewrite[]; afterFiles: Rewrite[]; fallback: Rewrite[] }

const escaped = MEDIA_TYPE.replace(/[.+]/g, '\\$&')

// every page: not api routes (ours included) and not next's internals
const page = '/:path((?!api/|_next/).+)'

// the same url answers html or a graph: agents ask with Accept (GET), Content-Type (POST), or ?afford=1
const conditions: NonNullable<Rewrite['has']>[] = [
  [{ type: 'header', key: 'accept', value: `.*${escaped}.*` }],
  [{ type: 'header', key: 'content-type', value: `.*${escaped}.*` }],
  [{ type: 'query', key: 'afford' }],
]

export const rewrites: Rewrite[] = [
  { source: WELL_KNOWN_PATH, destination: `${API_PATH}${WELL_KNOWN_PATH}` },
  ...conditions.flatMap((has) => [
    { source: '/', has, destination: API_PATH },
    { source: page, has, destination: `${API_PATH}/:path` },
  ]),
]

// /products/[slug] → /products/:slug, the path-to-regexp form next's headers() matches
export const toSource = (route: string) =>
  route
    .replace(/\[\[\.\.\.(\w+)\]\]/g, ':$1*')
    .replace(/\[\.\.\.(\w+)\]/g, ':$1+')
    .replace(/\[(\w+)\]/g, ':$1')

const normalize = (
  value: Awaited<ReturnType<NonNullable<NextConfig['rewrites']>>> | undefined,
): Rewrites =>
  Array.isArray(value)
    ? { beforeFiles: [], afterFiles: value as Rewrite[], fallback: [] }
    : {
        beforeFiles: (value?.beforeFiles ?? []) as Rewrite[],
        afterFiles: (value?.afterFiles ?? []) as Rewrite[],
        fallback: (value?.fallback ?? []) as Rewrite[],
      }

// a next config wrapper, the same shape as createMDX() or withMd: (config) => config
export type AffordPlugin = <C extends Config>(config: C) => C

export type AffordConfig = {
  // the site's name in /.well-known/afford.json
  name?: string
  // the project root; defaults to the directory next runs in
  root?: string
  // more afford capabilities on the same app, applied in order after the graph, e.g. [md()] from @afford/md/next
  plugins?: AffordPlugin[]
}

// the slice of NextConfig withAfford touches; generic so it accepts whichever copy of next the app has
type Config = Pick<NextConfig, 'rewrites' | 'headers'>

export const withAfford = <C extends Config>(
  nextConfig: C = {} as C,
  options: AffordConfig = {},
): C => {
  const root = options.root ?? process.cwd()
  const entries = generate(root, options)

  // dev: regenerate when an actions or state file changes; turbopack picks up the new manifest
  if (process.env.NODE_ENV === 'development') {
    let timer: ReturnType<typeof setTimeout> | undefined
    watch(findAppDir(root), { recursive: true }, (_, file) => {
      if (!file || !/(^|\/)(actions|state)\.[jt]sx?$/.test(file)) return
      clearTimeout(timer)
      timer = setTimeout(() => {
        try {
          generate(root, options)
        } catch (error) {
          console.error(`[afford] ${(error as Error).message}`)
        }
      }, 50)
    }).unref()
  }

  const afforded: C = {
    ...nextConfig,
    rewrites: async () => {
      const user = normalize(await nextConfig.rewrites?.())
      return { ...user, beforeFiles: [...rewrites, ...user.beforeFiles] }
    },
    headers: async () => [
      ...entries.map(({ route }) => ({
        source: toSource(route),
        headers: [{ key: 'Link', value: '<?afford=1>; rel="afford"' }],
      })),
      ...((await nextConfig.headers?.()) ?? []),
    ],
  }
  return (options.plugins ?? []).reduce((config, plugin) => plugin(config), afforded)
}

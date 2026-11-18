import { createHash } from 'node:crypto'
import { existsSync, readFileSync, watch } from 'node:fs'
import path from 'node:path'
import type { NextConfig } from 'next'
import { MEDIA_TYPE, WELL_KNOWN_PATH } from '@affordances/protocol'
import { findAppDir, generate, ID, segment } from './codegen.ts'
import { compileSync, writeCompiled } from './compile.ts'
import { API_PATH, MANIFEST_PATH, PROJECTION_BASE } from './constants.ts'
import { fails, format, type Diagnostic } from './diagnostics.ts'

export { API_PATH }

// set to the index's path on an app withAffordances wraps
export const INDEX_ENV = 'AFFORDANCES_INDEX'
// whether the capability manifest is listed and served (RFC 0005 §1, M7b2), and where the projection route is mounted:
// set from withAffordances' options, and read by next's routes. Next inlines env at build, so each is fixed per build
export const MANIFEST_ENV = 'AFFORDANCES_MANIFEST'
export const PROJECTION_ENV = 'AFFORDANCES_PROJECTION_BASE'

export type Rewrite = {
  source: string
  destination: string
  has?: { type: 'header' | 'query'; key: string; value?: string }[]
}
export type Rewrites = { beforeFiles: Rewrite[]; afterFiles: Rewrite[]; fallback: Rewrite[] }

const escaped = MEDIA_TYPE.replace(/[.+]/g, '\\$&')

// every page: not api routes (ours included) and not next's internals
const page = '/:path((?!api/|_next/).+)'

// the same url answers html or a graph: agents ask with Accept (GET), Content-Type (POST), or ?affordances=1
const conditions: NonNullable<Rewrite['has']>[] = [
  [{ type: 'header', key: 'accept', value: `.*${escaped}.*` }],
  [{ type: 'header', key: 'content-type', value: `.*${escaped}.*` }],
  [{ type: 'query', key: 'affordances' }],
]

export const rewrites: Rewrite[] = [
  { source: WELL_KNOWN_PATH, destination: `${API_PATH}${WELL_KNOWN_PATH}` },
  // the capability manifest, served by the same catch-all route as the index
  { source: MANIFEST_PATH, destination: `${API_PATH}${MANIFEST_PATH}` },
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
export type AffordancesPlugin = <C extends Config>(config: C) => C

export type AffordancesConfig = {
  // the site's name in /.well-known/affordances.json
  name?: string
  // the project root; defaults to the directory next runs in
  root?: string
  // more Affordances capabilities on the same app, applied in order after the graph, e.g. [md()] from @affordances/md/next
  plugins?: AffordancesPlugin[]
  /**
   * @experimental The capability manifest's namespace (RFC 0005 §1): an absolute URI with no fragment, such as
   * `https://acme.example/capabilities` (RFC 0001 §2). It's the app's identity, so it's never inferred: without one,
   * no manifest is written, and the build says which line turns it on (`W_NO_NAMESPACE`).
   */
  namespace?: string
  /**
   * @experimental The manifest's owner source (RFC 0005 §1). Only the configured owner's declarations are
   * `declared`; without one, the compiler reports `W_NO_OWNER`.
   */
  owner?: { id: string; name: string }
  /**
   * @experimental Strict mode (RFC 0005 §3): `W_NO_ID`, `W_INPUT_OPAQUE`, `W_INPUT_LOSSY` and `W_TSCONFIG_UNREADABLE`
   * become errors.
   */
  strict?: boolean
  /**
   * @experimental Whether the capability manifest is public (RFC 0005 §1): listed in the index and served at
   * `/.well-known/affordances/manifest.json`. `'private'` lists and serves neither, while views and execution keep
   * working. `'public'` by default; fixed per build.
   */
  manifest?: 'public' | 'private'
  /**
   * @experimental Where the app mounts its projection route (`createProjectionRoute`), so the index can name it as the
   * base of RFC 0004 §2's endpoints. A path from the site's root; `/api/projection` by default.
   */
  projection?: string
}

// RFC 0001's namespace: an absolute URI with no fragment (§2, and §7.3's schema table)
const URI = /^[A-Za-z][A-Za-z0-9+.-]*:[^#\s]*$/

/** @experimental What the capability compiler reads from withAffordances' options (RFC 0005 §1). */
export type Identity = {
  // absent when none is configured: then no manifest is written
  namespace?: string
  // the prefix suggested ids take, an identifier inferred from the site's name; absent when the name gives none
  idPrefix?: string
  owner?: { id: string; name: string }
  strict: boolean
}

// a site name as an id prefix, by codegen's rule for id words: 'Acme Store' is 'acmeStore'. Accents are dropped first, so
// 'Café' is 'cafe', not 'caf'
const fromName = (name: string) => segment(name.normalize('NFKD').replaceAll(/\p{M}/gu, ''))

/**
 * @experimental The capability manifest's identity, from withAffordances' options, checked: a namespace must be an
 * absolute URI, and an owner id an RFC 0001 §6.1 identifier. The namespace is never inferred.
 */
export const resolveIdentity = (options: AffordancesConfig = {}): Identity => {
  if (options.namespace !== undefined && !URI.test(options.namespace))
    throw new TypeError(
      `withAffordances: namespace '${options.namespace}' isn't an absolute URI without a fragment, such as 'https://acme.example/capabilities'`,
    )
  if (options.owner !== undefined) {
    if (!ID.test(options.owner.id))
      throw new TypeError(`withAffordances: owner.id '${options.owner.id}' isn't an identifier`)
    if (!options.owner.name.trim()) throw new TypeError('withAffordances: owner.name is empty')
  }
  const idPrefix = options.name?.trim() ? fromName(options.name) : undefined
  return {
    ...(options.namespace !== undefined && { namespace: options.namespace }),
    ...(idPrefix !== undefined && { idPrefix }),
    ...(options.owner && { owner: options.owner }),
    strict: options.strict ?? false,
  }
}

// a site URL read without running anything: a literal metadataBase in the root layout, then package.json's homepage
const siteUrl = (root: string): { url: string; from: string } | undefined => {
  const http = /^https?:\/\/[^\s#?]+$/
  for (const dir of ['app', 'src/app'])
    for (const ext of ['.tsx', '.ts', '.jsx', '.js']) {
      const file = path.join(dir, `layout${ext}`)
      if (!existsSync(path.join(root, file))) continue
      const literal = /metadataBase:\s*new URL\(\s*(['"`])([^'"`]+)\1\s*\)/.exec(
        readFileSync(path.join(root, file), 'utf8'),
      )?.[2]
      if (literal && http.test(literal)) return { url: literal, from: `${file}'s metadataBase` }
    }
  try {
    const { homepage } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      homepage?: unknown
    }
    if (typeof homepage === 'string' && http.test(homepage))
      return { url: homepage, from: "package.json's homepage" }
  } catch {
    // no package.json, or not JSON: nothing to suggest from
  }
  return undefined
}

/**
 * @experimental `W_NO_NAMESPACE` (RFC 0005 §3), with the line that turns the manifest on: a suggested value when the
 * site's URL can be read statically, never applied.
 */
export const noNamespace = (root: string): Diagnostic => {
  const config = ['next.config.ts', 'next.config.mjs', 'next.config.js'].find((f) =>
    existsSync(path.join(root, f)),
  )
  const site = siteUrl(root)
  const value = site
    ? `${new URL(site.url).origin}/capabilities`
    : 'https://<your-site>/capabilities'
  return {
    code: 'W_NO_NAMESPACE',
    file: config ?? 'next.config',
    detail: `add \`namespace: '${value}'\` to withAffordances' options${site ? ` (suggested from ${site.from}, not applied)` : ''}`,
  }
}

// compiled once per process and root, so what's written is never stale: a process always compiles for itself, even
// when an ancestor already did (a harness that spawns next build)
const compiled = new Set<string>()

// printed once per build. next loads its config in more than one process, and its workers inherit the environment, so
// what was printed is kept there, by root and line: a later load prints only what's new
export const PRINTED_ENV = 'AFFORDANCES_PRINTED'
const printed = () => new Set((process.env[PRINTED_ENV] ?? '').split('\n').filter(Boolean))
const print = (root: string, line: string, error: boolean, once = true) => {
  const key = `${root}\t${createHash('sha256').update(line).digest('base64url')}`
  const seen = printed()
  if (once && seen.has(key)) return
  process.env[PRINTED_ENV] = [...seen.add(key)].join('\n')
  if (error) console.error(line)
  else console.warn(line)
}

// RFC 0005 §4: compile the app's capabilities, write .affordances/, and print each diagnostic once. compileSync never
// reports W_NO_NAMESPACE, which withAffordances prints itself, with the line to paste
// `once`: a build prints each line once across its processes; dev's watcher prints every recompile's, so an error that
// comes back after a save shows again
const compile = (root: string, identity: Identity, once = true) => {
  const result = compileSync(root, identity)
  writeCompiled(root, result)
  for (const d of result.diagnostics)
    print(root, `[affordances] ${format(d, identity.strict)}`, fails(d.code, identity.strict), once)
  return result
}

// the manifest option, checked as the config loads
const manifestOption = (options: AffordancesConfig) => {
  const value = options.manifest ?? 'public'
  if (value !== 'public' && value !== 'private')
    throw new TypeError(
      `withAffordances: manifest is 'public' or 'private', not '${String(value)}'`,
    )
  return value
}

// the projection route's path, checked as the config loads: from the site's root, with no query or fragment
const projectionOption = (options: AffordancesConfig) => {
  const value = options.projection ?? PROJECTION_BASE
  if (!/^\/[^?#\s]*$/.test(value) || value.endsWith('/'))
    throw new TypeError(
      `withAffordances: projection is a path from the site's root, such as '/api/projection', not '${value}'`,
    )
  return value
}

// the slice of NextConfig withAffordances touches; generic so it accepts whichever copy of next the app has
// webpack is typed loosely: its context drags in all of NextConfig, which two copies of next don't agree on
export type Config = Pick<NextConfig, 'rewrites' | 'headers' | 'turbopack' | 'env'> & {
  // oxlint-disable-next-line no-explicit-any
  webpack?: ((config: any, context: any) => any) | null
}

export const withAffordances = <C extends Config>(
  nextConfig: C = {} as C,
  options: AffordancesConfig = {},
): C => {
  const root = options.root ?? process.cwd()
  // a bad namespace or owner fails here, as the config loads, not later in the capability compiler
  const identity = resolveIdentity(options)
  const visibility = manifestOption(options)
  const projection = projectionOption(options)
  const entries = generate(root, options)
  const dev = process.env.NODE_ENV === 'development'
  // once per root: next loads its config more than once in one build, and each compile runs the evaluator twice
  if (!compiled.has(root)) {
    compiled.add(root)
    const result = compile(root, identity)
    // no manifest, and nothing failed: no namespace anywhere, in the config or a defineManifest export, which carries
    // its own (RFC 0005 §1). Then the build names the one line that turns it on
    if (result.canonical === undefined && !result.failed)
      print(root, `[affordances] ${format(noNamespace(root))}`, false)
    // a failed compile fails next build; in dev it's logged, and the watcher recompiles on the next change
    if (result.failed && !dev)
      throw new Error(
        "[affordances] the capability manifest didn't compile; the diagnostics above say where",
      )

    // dev: regenerate and recompile when an actions, state or capabilities file changes; turbopack picks up the new
    // output
    if (dev) {
      let timer: ReturnType<typeof setTimeout> | undefined
      watch(findAppDir(root), { recursive: true }, (_, file) => {
        if (!file || !/(^|\/)(actions|state|capabilities)\.[jt]sx?$/.test(file)) return
        clearTimeout(timer)
        timer = setTimeout(() => {
          try {
            generate(root, options)
            compile(root, identity, false)
          } catch (error) {
            console.error(`[affordances] ${(error as Error).message}`)
          }
        }, 50)
      }).unref()
    }
  }

  // the route handler imports @affordances/next/manifest; point it at this app's generated one. Its capability manifest
  // goes the same way, @affordances/next/compiled to the .affordances/capabilities.ts the compiler always writes, so
  // the route reads it from the bundle, never from disk at request time
  const manifest = path.join(root, '.affordances', 'manifest.ts')
  const compiledModule = path.join(root, '.affordances', 'capabilities.ts')
  const afforded: C = {
    ...nextConfig,
    // where the app's Affordances index is, for plugins that read it when a request comes in (md's llms handlers):
    // in env, so it's there whichever wrapper runs first
    env: {
      ...nextConfig.env,
      [INDEX_ENV]: WELL_KNOWN_PATH,
      [MANIFEST_ENV]: visibility,
      [PROJECTION_ENV]: projection,
    },
    turbopack: {
      ...nextConfig.turbopack,
      // turbopack takes a path relative to the project, not an absolute one
      resolveAlias: {
        ...nextConfig.turbopack?.resolveAlias,
        '@affordances/next/manifest': `./${path.relative(process.cwd(), manifest)}`,
        '@affordances/next/compiled': `./${path.relative(process.cwd(), compiledModule)}`,
      },
    },
    webpack: (config, context) => {
      config.resolve.alias['@affordances/next/manifest'] = manifest
      config.resolve.alias['@affordances/next/compiled'] = compiledModule
      return nextConfig.webpack ? nextConfig.webpack(config, context) : config
    },
    rewrites: async () => {
      const user = normalize(await nextConfig.rewrites?.())
      return { ...user, beforeFiles: [...rewrites, ...user.beforeFiles] }
    },
    headers: async () => [
      ...entries.map(({ route }) => ({
        source: toSource(route),
        headers: [{ key: 'Link', value: '<?affordances=1>; rel="affordances"' }],
      })),
      ...((await nextConfig.headers?.()) ?? []),
    ],
  }
  return (options.plugins ?? []).reduce((config, plugin) => plugin(config), afforded)
}

// the app's pages, found at build time by md() so llms.txt and the Link header work without the Affordances index.
// node:fs is loaded only when md() runs in next.config, so the route handlers that share this entry stay edge-safe

// passed from next.config to the handlers through next's `env`, which inlines it at build time
export const ROUTES_ENV = 'AFFORDANCES_MD_ROUTES'

const PAGE = /^page\.(tsx|ts|jsx|js|mdx|md)$/
const MARKDOWN = /^markdown\.(tsx|ts|js)$/
const HANDLER = /^route\.(tsx|ts|jsx|js)$/
// next's metadata routes, route handlers too though not named route.ts: their url, from the file's name
const METADATA: [RegExp, (name: string) => string][] = [
  [/^(sitemap)\.(tsx|ts|jsx|js)$/, () => 'sitemap.xml'],
  [/^(robots)\.(tsx|ts|jsx|js)$/, () => 'robots.txt'],
  [/^(manifest)\.(tsx|ts|jsx|js)$/, () => 'manifest.webmanifest'],
  [/^(opengraph-image|twitter-image|icon|apple-icon)\.(tsx|ts|jsx|js)$/, (name) => name],
]

// app/ or src/app/ under the project root
export const findAppDir = (root: string) => {
  const fs = process.getBuiltinModule?.('node:fs')
  const path = process.getBuiltinModule?.('node:path')
  return ['app', 'src/app']
    .map((dir) => path?.join(root, dir))
    .find((dir) => dir && fs?.existsSync(dir))
}

// a route's markdown.ts: the file relative to the project root, without its extension
export type MarkdownFile = { route: string; file: string }
// what md() reports about a markdown.ts, and the generated check repeats so tsc stops on it: a file that isn't one,
// left out
export type Problem = { route: string; message: string }

// what a markdown.ts next to a page can export for affordances
const EXPORTS = ['default', 'slots', 'publicCache', 'notFoundMarkdown']
const MENTIONED = new RegExp(`\\b(${EXPORTS.join('|')})\\b|\\bexport\\s*\\*|\\bexports\\b`)
// the names a markdown.ts exports, when it exports some and reading its text makes plain none is one of EXPORTS:
// undefined when it may have one (it mentions one anywhere, re-exports everything from another module, or is commonjs)
// or exports nothing yet (a file just made in next dev). so a file is only ever left out when it can't fit; any other
// mistake is the generated check's, as before
export const unfitExports = (source: string): string[] | undefined => {
  if (MENTIONED.test(source)) return undefined
  const names = [
    ...source.matchAll(
      /\bexport\s+(?:declare\s+)?(?:async\s+)?(?:const|let|var|function\*?|class|enum)\s+([\w$]+)/g,
    ),
  ].map((match) => match[1]!)
  for (const [, list] of source.matchAll(/\bexport\s*\{([^}]*)\}/g))
    for (const item of list!.split(',')) {
      const name = item
        .trim()
        .split(/\s+as\s+/)
        .at(-1)
      if (name && !/^type\s/.test(item.trim())) names.push(name)
    }
  return names.length ? [...new Set(names)] : undefined
}
const unfitMessage = (file: string, route: string, names: string[]) =>
  `${file} has none of the exports a markdown.ts next to a page uses (${EXPORTS.join(', ')}): it exports ${names.join(', ')}. So it's left out, and ${route} converts from its HTML. If it isn't for @affordances/md, move it out of app/ or rename it.`

// app/(shop)/products/[slug]/page.tsx → /products/[slug]. skipped: _private folders, @slots (they render into
// their parent's url), intercepting routes, and api/, which the markdown rewrites never reach. a markdown.ts next to
// a page is recorded too; one without a page has no url, so it's left out with a warning, and one that has none of the
// exports a markdown.ts uses is left out with an error, which the generated check repeats so tsc stops on it
export const scanApp = (
  root: string,
): { pages: string[]; markdown: MarkdownFile[]; problems: Problem[]; handlers: string[] } => {
  const fs = process.getBuiltinModule?.('node:fs')
  const path = process.getBuiltinModule?.('node:path')
  const app = findAppDir(root)
  if (!fs || !path || !app) {
    // the Link headers and the default llms lists come from here; say why they'd be empty
    console.warn(
      `[affordances-md] ${fs ? `no app/ directory in ${root}; pass md({ root })` : 'reading app/ needs Node 20.16 or later'}, so pages get no Link header and llms.txt lists none by default`,
    )
    return { pages: [], markdown: [], problems: [], handlers: [] }
  }
  const pages: string[] = []
  // route handlers outside api/ (/llms.txt, /og/[slug]), which the Accept rewrite leaves alone
  const handlers: string[] = []
  const markdown: MarkdownFile[] = []
  const problems: Problem[] = []
  const walk = (dir: string, segments: string[]) => {
    const children = fs.readdirSync(dir, { withFileTypes: true })
    const route = `/${segments.join('/')}`
    const page = children.some((child) => child.isFile() && PAGE.test(child.name))
    if (page) pages.push(route)
    else if (children.some((child) => child.isFile() && HANDLER.test(child.name)))
      handlers.push(route)
    for (const child of children)
      for (const [file, url] of METADATA) {
        const name = child.isFile() && file.exec(child.name)?.[1]
        if (name) handlers.push(`${route === '/' ? '' : route}/${url(name)}`)
      }
    const own = children.find((child) => child.isFile() && MARKDOWN.test(child.name))
    if (own) {
      const file = path.join(dir, own.name)
      const relative = path.relative(root, file)
      if (!page)
        console.warn(`[affordances-md] ${relative} has no page.tsx next to it, so it's ignored`)
      else {
        // a file that can't be read is taken as it is, as before: the import or the generated check says what's wrong
        let names: string[] | undefined
        try {
          names = unfitExports(fs.readFileSync(file, 'utf8'))
        } catch {
          names = undefined
        }
        if (names) {
          const message = unfitMessage(relative.split(path.sep).join('/'), route, names)
          console.error(`[affordances-md] ${message}`)
          problems.push({ route, message })
        } else markdown.push({ route, file: relative.replace(/\.[jt]sx?$/, '') })
      }
    }
    for (const child of children) {
      const name = child.name
      if (!child.isDirectory() || /^[_@]|^\(\.|^node_modules$/.test(name)) continue
      if (!segments.length && name === 'api') continue
      walk(path.join(dir, name), /^\(.*\)$/.test(name) ? segments : [...segments, name])
    }
  }
  walk(app, [])
  return {
    pages: pages.toSorted((a, b) => a.localeCompare(b)),
    markdown: markdown.toSorted((a, b) => a.route.localeCompare(b.route)),
    problems: problems.toSorted((a, b) => a.route.localeCompare(b.route)),
    handlers: handlers.toSorted((a, b) => a.localeCompare(b)),
  }
}

// public/'s files, which next serves before any dynamic page, so a root catch-all never gets a twin for them: each
// file's url as a request asks for it (percent-encoded, as next matches a source), or a folder's, `/images/*.png|.jpg`,
// for its files of those extensions only ('' for a name with none), so a page under the same name (/images/gallery,
// /docs/next.js) keeps its twin. symlinks are followed. the folder holding the most files is folded first, until the
// pattern hasTwin and the Link rules share fits PUBLIC_BUDGET, which keeps the env value next inlines small too
export const PUBLIC_ENV = 'AFFORDANCES_MD_PUBLIC'
const PUBLIC_BUDGET = 2000
export const scanPublic = (root: string): string[] => {
  const fs = process.getBuiltinModule?.('node:fs')
  const path = process.getBuiltinModule?.('node:path')
  const dir = path?.join(root, 'public')
  if (!fs || !path || !dir || !fs.existsSync(dir)) return []
  const files: string[] = []
  const seen = new Set<string>()
  const walk = (at: string, url: string) => {
    let real: string
    try {
      real = fs.realpathSync(at)
    } catch {
      return
    }
    // a link back up the tree is walked once
    if (seen.has(real)) return
    seen.add(real)
    for (const child of fs.readdirSync(at, { withFileTypes: true })) {
      const next = path.join(at, child.name)
      let folder = child.isDirectory()
      if (child.isSymbolicLink())
        try {
          folder = fs.statSync(next).isDirectory()
        } catch {
          continue
        }
      if (folder) walk(next, `${url}/${child.name}`)
      else files.push(asRequested(`${url}/${child.name}`))
    }
  }
  walk(dir, '')
  // each folder's files, counted once
  const under = new Map<string, string[]>()
  for (const file of files) {
    const parts = file.split('/').slice(1, -1)
    for (let i = 1; i <= parts.length; i += 1) {
      const folder = `/${parts.slice(0, i).join('/')}/`
      const held = under.get(folder)
      if (held) held.push(file)
      else under.set(folder, [file])
    }
  }
  // the most files first, the deepest of those that hold the same. each fold takes its folder's files out of the
  // pattern and puts one entry in, its length kept as it goes, so no step rebuilds the whole pattern
  const order = [...under].toSorted(
    (x, y) => y[1].length - x[1].length || y[0].length - x[0].length,
  )
  const entries = new Set(files)
  const folded: string[] = []
  let length = publicPattern(files).length
  const fold = (folder: string, inside: string[]) => {
    for (const file of inside) if (entries.delete(file)) length -= publicPattern([file]).length + 1
    for (const entry of folded.filter((other) => other.startsWith(folder))) {
      entries.delete(entry)
      length -= publicPattern([entry]).length + 1
    }
    const kinds = [
      ...new Set(
        inside.map((file) => /\.[^./]*$/.exec(file.slice(file.lastIndexOf('/')))?.[0] ?? ''),
      ),
    ]
    const entry = `${folder}*${kinds.toSorted().join('|')}`
    entries.add(entry)
    folded.push(entry)
    length += publicPattern([entry]).length + 1
  }
  for (const [folder, inside] of order) {
    if (length <= PUBLIC_BUDGET) break
    // already inside a folded folder
    if (!folded.some((entry) => folder.startsWith(entry.slice(0, entry.indexOf('*')))))
      fold(folder, inside)
  }
  // folders side by side at the top that still don't fit: public/ itself, by kind of file
  if (length > PUBLIC_BUDGET) fold('/', files)
  return [...entries].toSorted((x, y) => x.localeCompare(y))
}
// a public/ path as a request's pathname has it
const asRequested = (name: string) => {
  const url = new URL('http://public')
  url.pathname = name
  return url.pathname
}
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// public/'s entries as one regex source over a pathname without its leading /: hasTwin tests it, and the Link rules'
// lookahead is it, so a public file never gets a Link to a twin it doesn't have
export const publicPattern = (entries: string[]) =>
  entries
    .map((entry) => {
      const star = entry.indexOf('*')
      if (star < 0) return escaped(entry.slice(1))
      const kinds = entry
        .slice(star + 1)
        .split('|')
        .map((kind) => (kind ? `[^/]*${escaped(kind)}` : '[^/.]+'))
      return `${escaped(entry.slice(1, star))}(?:[^/]+/)*(?:${kinds.join('|')})`
    })
    .join('|')

// the token mdProxy and the handler share: made once, kept in next's own cache folder (.next/cache, which next build
// keeps and git ignores), so every compiler of one build (each loads next.config) inlines the same one. never derived
// from anything a caller can see. a tree it can't write still gets one, for this load
export const adoptToken = (root: string, distDir?: string) => {
  const fs = process.getBuiltinModule?.('node:fs')
  const path = process.getBuiltinModule?.('node:path')
  const file = path?.join(root, distDir ?? '.next', 'cache', 'affordances-md', 'adopt-token')
  if (fs && file)
    try {
      const saved = fs.readFileSync(file, 'utf8').trim()
      if (/^[\w-]{32,}$/.test(saved)) return saved
    } catch {}
  const token = crypto.randomUUID()
  if (fs && path && file)
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, token, { mode: 0o600 })
    } catch {}
  return token
}

// .affordances/md.ts: one lazy import per route's markdown.ts, which @affordances/md/routes is aliased to. written
// only when it changed, so watchers don't loop. its path, or undefined when there's no markdown.ts
export const writeMarkdownRoutes = (
  root: string,
  files: MarkdownFile[],
  problems: Problem[] = [],
  // next.config's cacheLife profiles beyond next's own, which a publicCache may name too
  profiles: string[] = [],
) => {
  const fs = process.getBuiltinModule?.('node:fs')
  const path = process.getBuiltinModule?.('node:path')
  if (!fs || !path) return undefined
  const out = path.join(root, '.affordances', 'md.ts')
  // nothing left (the last markdown.ts removed, or the one md() reported moved as it said): a file from an earlier
  // build would keep its routes and its errors, so it's rewritten empty. no alias, so no markdown.ts runs
  if (!(files.length || problems.length)) {
    try {
      if (fs.existsSync(out) && fs.readFileSync(out, 'utf8') !== EMPTY) fs.writeFileSync(out, EMPTY)
    } catch (error) {
      console.warn(
        `[affordances-md] couldn't empty .affordances/md.ts (${errorCode(error)}), which still checks the markdown.ts files of an earlier build. Delete it, or make .affordances/ writable.`,
      )
    }
    return undefined
  }
  const code = `// generated by @affordances/md from app/**/markdown.ts; don't edit
import type { CacheLifeProfile, MarkdownModule, MarkdownRoutes, PublicCache } from '@affordances/md/next'

// the cacheLife profiles a publicCache can name: next's own and next.config's
type Profile = ${['CacheLifeProfile', ...profiles.map((name) => JSON.stringify(name))].join(' | ')}

// each markdown.ts is checked against its own route. a type error on a line here means that file's default export or
// slots name another route (MarkdownArgs<'/…'>, Slots<'/…'>) or return something else: fix it in that file
export const routes = {
${files.map((entry) => `  ${JSON.stringify(entry.route)}: (): Promise<MarkdownModule<${JSON.stringify(entry.route)}, PublicCache<Profile>>> =>\n    import(${JSON.stringify(`../${entry.file.split(path.sep).join('/')}`)}),`).join('\n')}
} satisfies MarkdownRoutes
${
  problems.length
    ? `
// what md() reported about a markdown.ts: tsc stops on each line below, with what to do about it in its message
type Fix<What extends never> = What
${problems.map(({ message }, i) => `export type Problem${i} = Fix<${JSON.stringify(message)}>`).join('\n')}
`
    : ''
}`
  // a read-only tree (a sandbox, a checkout owned by another user, a read-only image layer) never stops the config from
  // loading: with the file from an earlier build, that one is used; without one, no markdown.ts runs and pages convert
  try {
    fs.mkdirSync(path.dirname(out), { recursive: true })
    if (!fs.existsSync(out) || fs.readFileSync(out, 'utf8') !== code) fs.writeFileSync(out, code)
  } catch (error) {
    const stale = fs.existsSync(out)
    console.warn(
      `[affordances-md] couldn't write .affordances/md.ts (${errorCode(error)}), so ${stale ? 'the one already there is used, and a markdown.ts added or removed since it was written is missed' : 'no markdown.ts runs and pages are converted from their HTML'}. Make .affordances/ writable for next dev and next build.`,
    )
    if (!stale) return undefined
  }
  sayInclude(path.join(root, 'tsconfig.json'))
  return out
}

// .affordances/md.ts with no markdown.ts left to check
const EMPTY = `// generated by @affordances/md from app/**/markdown.ts; don't edit
export const routes = {}
`

// an fs error's code (EACCES, EROFS), for a warning
const errorCode = (error: unknown) =>
  (typeof error === 'object' && error !== null && 'code' in error && String(error.code)) ||
  String(error)

const GENERATED = '.affordances/**/*.ts'
export { GENERATED }

// the index of a comment's last character when one starts at i (// up to its line's end, /* to */), else undefined
const commentEnd = (text: string, i: number) => {
  if (text[i] !== '/') return undefined
  if (text[i + 1] === '/') {
    const line = text.indexOf('\n', i)
    return (line < 0 ? text.length : line) - 1
  }
  if (text[i + 1] !== '*') return undefined
  const end = text.indexOf('*/', i + 2)
  if (end < 0) throw new SyntaxError('Unterminated comment')
  return end + 1
}

// tsconfig.json's text with its comments and trailing commas taken out, for JSON.parse. strings are kept as they are
const plainJson = (text: string) => {
  let out = ''
  for (let i = 0; i < text.length; i += 1) {
    const comment = commentEnd(text, i)
    if (comment !== undefined) i = comment
    else if (text[i] === '"') {
      const end = stringEnd(text, i)
      out += text.slice(i, end)
      i = end - 1
    } else out += text[i]
  }
  return out.replace(/,(\s*[\]}])/g, '$1')
}
// the index just past a JSON string that starts at i
const stringEnd = (text: string, i: number) => {
  let j = i + 1
  while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1
  if (j >= text.length) throw new SyntaxError('Unterminated string')
  return j + 1
}
const parseJsonc = (text: string): unknown => JSON.parse(plainJson(text))

// the top-level "include" array in tsconfig.json's own text: where its last entry ends, whether a comma follows it,
// and where the array closes. undefined when the file has none of its own
const includeArray = (text: string) => {
  let depth = 0
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!
    const comment = commentEnd(text, i)
    if (comment !== undefined) i = comment
    else if (char === '{' || char === '[') depth += 1
    else if (char === '}' || char === ']') depth -= 1
    else if (char === '"') {
      const end = stringEnd(text, i)
      const key = text.slice(i, end)
      i = end - 1
      const open = /^\s*:\s*\[/.exec(text.slice(end))
      if (depth !== 1 || key !== '"include"' || !open) continue
      // inside the array: entries are strings, maybe with comments and a trailing comma between them
      let at = end + open[0].length
      let last: number | undefined
      let comma = false
      for (; at < text.length && text[at] !== ']'; at += 1) {
        const inner = commentEnd(text, at)
        if (inner !== undefined) at = inner
        else if (text[at] === '"') {
          at = stringEnd(text, at) - 1
          last = at + 1
          comma = false
        } else if (text[at] === ',') comma = true
        else if (!/\s/.test(text[at]!)) return undefined
      }
      return { start: end + open[0].length, last, comma, close: at }
    }
  }
  return undefined
}

// tsc skips a folder whose name starts with a dot unless include names it, so with next's default tsconfig the check
// of each markdown.ts against its route only runs once include names .affordances/. md() never edits tsconfig.json: it
// says the line, once per process. \`affordances-md init\` adds it, changing only the include array and keeping the
// file's comments and formatting
export const includesGenerated = (text: string) => {
  const config = parseJsonc(text) as { include?: unknown }
  return (
    Array.isArray(config.include) &&
    config.include.some((entry) => typeof entry === 'string' && entry.startsWith('.affordances/'))
  )
}
// tsconfig.json with .affordances/ added to its include, or why that can't be done safely (the file doesn't parse,
// include is inherited through extends or missing, or the edit wouldn't read back as just that entry added)
export const withGenerated = (text: string): { text: string } | { why: string } => {
  let before: { include?: unknown }
  try {
    before = parseJsonc(text) as { include?: unknown }
  } catch {
    return { why: "couldn't be read" }
  }
  if (!Array.isArray(before.include))
    return { why: 'has no "include" of its own to add .affordances/ to' }
  const array = includeArray(text)
  if (!array) return { why: 'has an "include" that can\'t be edited safely' }
  const entry = JSON.stringify(GENERATED)
  let edited: string
  if (array.last === undefined)
    edited = `${text.slice(0, array.start)}${entry}${text.slice(array.start)}`
  else if (!text.slice(array.start, array.close).includes('\n'))
    edited = `${text.slice(0, array.last)}, ${entry}${text.slice(array.last)}`
  else {
    // one entry per line: a line of its own, indented as the first entry is, after the last one and its comment
    const indent = /\n([ \t]*)\S/.exec(text.slice(array.start - 1, array.close))?.[1] ?? '  '
    const lineEnd = text.indexOf('\n', array.last)
    const end = lineEnd < 0 || lineEnd > array.close ? array.close : lineEnd
    const after = text.slice(array.last, end)
    const comma = array.comma ? '' : ','
    edited = `${text.slice(0, array.last)}${comma}${after}\n${indent}${entry}${array.comma ? ',' : ''}${text.slice(end)}`
  }
  try {
    const after = parseJsonc(edited) as { include: unknown[] }
    const expected = { ...before, include: [...before.include, GENERATED] }
    if (JSON.stringify(after) !== JSON.stringify(expected))
      return { why: 'has an "include" that can\'t be edited safely' }
  } catch {
    return { why: 'has an "include" that can\'t be edited safely' }
  }
  return { text: edited }
}
// said once per tsconfig.json per process, never on each rebuild of next dev
const includeTold = new Set<string>()
const sayInclude = (tsconfig: string) => {
  const fs = process.getBuiltinModule?.('node:fs')
  if (includeTold.has(tsconfig) || !fs?.existsSync(tsconfig)) return
  try {
    if (includesGenerated(fs.readFileSync(tsconfig, 'utf8'))) return
  } catch {}
  includeTold.add(tsconfig)
  console.warn(
    `[affordances-md] To have tsc check each markdown.ts against its route, add "${GENERATED}" to "include" in tsconfig.json, or run \`affordances-md init\`, which adds it. md() doesn't edit tsconfig.json.`,
  )
}

// a list md() passed through next's env, or none when it didn't run (withMd left out, or a test), keeping only the
// items guard accepts
const list = <T>(raw: string | undefined, guard: (item: unknown) => item is T): T[] => {
  try {
    const items: unknown = JSON.parse(raw ?? '[]')
    return Array.isArray(items) ? items.filter(guard) : []
  } catch {
    return []
  }
}
const isString = (item: unknown): item is string => typeof item === 'string'
const strings = (raw: string | undefined) => list(raw, isString)

// a value built once per value of the env next inlined. each caller passes process.env.NAME spelled out, since next
// inlines that, never process.env[name]
export const perEnv = <T, A extends unknown[] = []>(build: (...args: A) => T) => {
  let cache: { key: string | undefined; value: T } | undefined
  return (key: string | undefined, ...args: A) => {
    if (!cache || cache.key !== key) cache = { key, value: build(...args) }
    return cache.value
  }
}

// the routes md() found. spelled out: next inlines process.env.NAME, never process.env[name]
export const builtPages = (): string[] => strings(process.env.AFFORDANCES_MD_ROUTES)

// the route handlers md() found outside api/, through next's env as the pages are
export const HANDLERS_ENV = 'AFFORDANCES_MD_HANDLERS'
export const builtHandlers = (): string[] => strings(process.env.AFFORDANCES_MD_HANDLERS)
// public/'s files md() found, and whether a url is one of them (or under a folder that stands for its files)
const builtPublic = perEnv((raw: string | undefined) => {
  const pattern = publicPattern(strings(raw))
  return pattern ? new RegExp(`^/(?:${pattern})$`) : undefined
})
export const isPublicFile = (pathname: string) =>
  // spelled out: next inlines process.env.NAME, never process.env[name]
  builtPublic(process.env.AFFORDANCES_MD_PUBLIC, process.env.AFFORDANCES_MD_PUBLIC)?.test(
    pathname,
  ) ?? false
// path-to-regexp names are word characters: [product-id] → :productid
const param = (name: string) => name.replace(/\W/g, '')

// /products/[slug] → /products/:slug, the path-to-regexp form next's headers() matches
// a folder name is matched as itself: path-to-regexp's own characters in it (x(.*), p:id, star*) are escaped
export const toSource = (route: string) =>
  route
    .split('/')
    .map((segment) => {
      const { kind, name } = routeSegment(segment)
      if (kind === 'static') return segment.replace(/[\\:()*+?{}]/g, '\\$&')
      return `:${param(name)}${kind === 'any' ? '*' : kind === 'some' ? '+' : ''}`
    })
    .join('/')

// md({ literalMd }): routes whose own urls may end in .md, passed to the handlers the same way
export const LITERAL_ENV = 'AFFORDANCES_MD_LITERAL'

export const builtLiteral = (): string[] => strings(process.env.AFFORDANCES_MD_LITERAL)

const escape = (value: string) => value.replace(/[.+*?=^!:${}()[\]|/\\]/g, '\\$&')

// a deliberate copy of path-to-regexp 6, the version next compiles into next/dist/compiled: next is an optional peer
// of this package, and that path is internal to next, free to move in any release. next.test.ts compares it against
// next's own matcher, so drift shows up as a failing test
type Token =
  | { type: 'char' | 'escaped' | 'name' | 'pattern' | 'modifier' | 'open' | 'close'; value: string }
  | { type: 'end'; value: '' }

// path-to-regexp 6's lexer, the version next compiles: :name, (pattern), {groups}, ? * + and \escapes
const lex = (source: string): Token[] => {
  const tokens: Token[] = []
  for (let i = 0; i < source.length;) {
    const char = source[i]!
    if ('*+?'.includes(char)) tokens.push({ type: 'modifier', value: source[i++]! })
    else if (char === '\\') tokens.push({ type: 'escaped', value: source[(i += 2) - 1]! })
    else if (char === '{') tokens.push({ type: 'open', value: source[i++]! })
    else if (char === '}') tokens.push({ type: 'close', value: source[i++]! })
    else if (char === ':') {
      const name = /^\w+/.exec(source.slice(i + 1))?.[0]
      if (!name) throw new TypeError(`Missing parameter name at ${i} in ${source}`)
      tokens.push({ type: 'name', value: name })
      i += name.length + 1
    } else if (char === '(') {
      let depth = 1
      let pattern = ''
      let j = i + 1
      if (source[j] === '?')
        throw new TypeError(`Pattern cannot start with "?" at ${j} in ${source}`)
      for (; j < source.length; j += 1) {
        if (source[j] === '\\') {
          pattern += source[j]! + source[++j]!
          continue
        }
        if (source[j] === ')' && --depth === 0) break
        if (source[j] === '(') {
          depth += 1
          if (source[j + 1] !== '?')
            throw new TypeError(`Capturing groups are not allowed at ${j} in ${source}`)
        }
        pattern += source[j]
      }
      if (depth) throw new TypeError(`Unbalanced pattern at ${i} in ${source}`)
      if (!pattern) throw new TypeError(`Missing pattern at ${i} in ${source}`)
      tokens.push({ type: 'pattern', value: pattern })
      i = j + 1
    } else tokens.push({ type: 'char', value: source[i++]! })
  }
  tokens.push({ type: 'end', value: '' })
  return tokens
}

type Param = {
  name: string
  prefix: string
  suffix: string
  pattern: string
  modifier: string
  // written with its own (pattern), and inside a {group}: what a source needs to be written back
  custom: boolean
  group: boolean
}
type Part = string | Param

// path-to-regexp 6's parse, with next's delimiter '/'
const parse = (source: string): Part[] => {
  const tokens = lex(source)
  const parts: Part[] = []
  // path-to-regexp numbers the unnamed params, (pattern) and {groups}, from 0
  let unnamed = 0
  let at = 0
  let path = ''
  const take = (type: Token['type']) =>
    tokens[at]?.type === type ? tokens[at++]!.value : undefined
  const must = (type: Token['type']) => {
    const value = take(type)
    if (value === undefined)
      throw new TypeError(`Unexpected ${tokens[at]?.type} in ${source}, expected ${type}`)
    return value
  }
  const text = () => {
    let value = ''
    for (
      let next = take('char') ?? take('escaped');
      next !== undefined;
      next = take('char') ?? take('escaped')
    )
      value += next
    return value
  }
  // a param's default pattern: anything but a slash, and not running into the text before it
  const safe = (prefix: string) => {
    const last = parts.at(-1)
    const before = prefix || (typeof last === 'string' ? last : '')
    if (last && typeof last !== 'string' && !before)
      throw new TypeError(`Must have text between two parameters in ${source}`)
    return !before || before.includes('/') ? '[^\\/]+?' : `(?:(?!${escape(before)})[^\\/])+?`
  }
  while (at < tokens.length) {
    const char = take('char')
    const name = take('name')
    const pattern = take('pattern')
    if (name !== undefined || pattern !== undefined) {
      let prefix = char ?? ''
      if (!'./'.includes(prefix) || !prefix) {
        path += prefix
        prefix = ''
      }
      if (path) parts.push(path)
      path = ''
      parts.push({
        name: name ?? String(unnamed++),
        prefix,
        suffix: '',
        pattern: pattern ?? safe(prefix),
        modifier: take('modifier') ?? '',
        custom: pattern !== undefined,
        group: false,
      })
      continue
    }
    const value = char ?? take('escaped')
    if (value !== undefined) {
      path += value
      continue
    }
    if (path) parts.push(path)
    path = ''
    if (take('open') !== undefined) {
      const prefix = text()
      const named = take('name') ?? ''
      const own = take('pattern') ?? ''
      const suffix = text()
      must('close')
      parts.push({
        // as path-to-regexp numbers them: only a param that captures, so a {group} of plain text takes no number
        name: named || (own ? String(unnamed++) : ''),
        prefix,
        suffix,
        pattern: named && !own ? safe(prefix) : own,
        modifier: take('modifier') ?? '',
        custom: Boolean(own),
        group: true,
      })
      continue
    }
    must('end')
  }
  return parts
}

// a next source as a regex over a pathname, as next's own matcher builds it (path-to-regexp 6, case-insensitive).
// throws on a source next would reject too
export const sourceRegex = (source: string, flags = 'i') => {
  const body = parse(source)
    .map((part) => {
      if (typeof part === 'string') return escape(part)
      const { pattern, modifier } = part
      const prefix = escape(part.prefix)
      const suffix = escape(part.suffix)
      if (!pattern) return `(?:${prefix}${suffix})${modifier}`
      if (!prefix && !suffix) {
        if (modifier === '*' || modifier === '+')
          throw new TypeError(`Can not repeat a parameter without a prefix and suffix in ${source}`)
        return `(${pattern})${modifier}`
      }
      if (modifier === '*' || modifier === '+')
        return `(?:${prefix}((?:${pattern})(?:${suffix}${prefix}(?:${pattern}))*)${suffix})${modifier === '*' ? '?' : ''}`
      return `(?:${prefix}(${pattern})${suffix})${modifier}`
    })
    .join('')
  return new RegExp(`^${body}$`, flags)
}

// a source's params in the order sourceRegex captures them: a {group} without a pattern captures nothing
export const sourceParams = (source: string) =>
  parse(source).flatMap((part) => (typeof part === 'string' || !part.pattern ? [] : [part.name]))

// a destination as a function that fills in its params, as next fills a rewrite's: a missing optional one leaves out
// its prefix. parsed once, since it runs for every twin link
export const compileDestination = (destination: string) => {
  const parts = parse(destination)
  return (params: Record<string, string | undefined>) =>
    parts
      .map((part) => {
        if (typeof part === 'string') return part
        const value = params[part.name]
        return value === undefined ? '' : `${part.prefix}${value}${part.suffix}`
      })
      .join('')
}

// a source written back from its parts: its text escaped again, and each param with the pattern it was given
const escapeText = (text: string) => text.replace(/[\\:()*+?{}]/g, '\\$&')
const writeSource = (parts: Part[]) =>
  parts
    .map((part) => {
      if (typeof part === 'string') return escapeText(part)
      const written = `${part.name && !/^\d+$/.test(part.name) ? `:${part.name}` : ''}${part.custom ? `(${part.pattern})` : ''}`
      return part.group
        ? `{${escapeText(part.prefix)}${written}${escapeText(part.suffix)}}${part.modifier}`
        : `${escapeText(part.prefix)}${written}${part.modifier}`
    })
    .join('')

// the Link rules a source needs, each a source and its value's template. next fills a header value only with the
// params a url has, so an absent optional param would stay a literal :name: each optional param gets a rule where
// it's there (required) and one where it isn't. a repeated param is filled only as :name+, which the template keeps.
// undefined for a source next can't fill a value from at all: an unnamed param, which next leaves out of a header's
// params, or more optional params than are worth a rule each
export const linkSources = (source: string): { source: string; template: string }[] | undefined => {
  const parts = parse(source)
  const params = parts.filter((part): part is Param => typeof part !== 'string')
  if (params.some((part) => part.pattern && /^\d+$/.test(part.name))) return undefined
  const optional = params.filter((part) => part.modifier === '?' || part.modifier === '*')
  if (optional.length > 3) return undefined
  return Array.from({ length: 2 ** optional.length }, (_, mask) => {
    const chosen = parts.flatMap((part): Part[] => {
      if (typeof part === 'string') return [part]
      const at = optional.indexOf(part)
      if (at < 0) return [part]
      if (!(mask & (1 << at))) return []
      // a {group} of plain text is just its text when it's there
      if (!part.pattern) return [`${part.prefix}${part.suffix}`]
      return [{ ...part, modifier: part.modifier === '*' ? '+' : '' }]
    })
    const template = chosen
      .map((part) =>
        typeof part === 'string'
          ? part
          : `${part.prefix}:${part.name}${part.modifier}${part.suffix}`,
      )
      .join('')
    return { source: writeSource(chosen) || '/', template: template || '/' }
  })
}

// md({ aliases }): public url shapes and the app/ routes they render, passed to the handlers the same way
export const ALIASES_ENV = 'AFFORDANCES_MD_ALIASES'

// spelled out: next inlines process.env.NAME, never process.env[name]
export const builtAliases = (): [source: string, destination: string][] =>
  list(
    process.env.AFFORDANCES_MD_ALIASES,
    (pair): pair is [string, string] =>
      Array.isArray(pair) && pair.length === 2 && pair.every(isString),
  )

// a segment as how many of the other side's it can stand for, and its text when that's fixed
type Fit = { min: number; max: number; text?: string }
const ONE: Fit = { min: 1, max: 1 }
// a folder name as a route segment: [x] one of any value, [...x] one or more, [[...x]] none or more, else itself
export const routeSegment = (
  segment: string,
): { kind: 'static' | 'one' | 'some' | 'any'; name: string } => {
  const [, dots, name] = /^\[(\[\.\.\.|\.\.\.)?([^\]]+)\]?\]$/.exec(segment) ?? []
  if (name === undefined || (dots === '[...') !== segment.endsWith(']]'))
    return { kind: 'static', name: segment }
  return { kind: dots === '[...' ? 'any' : dots ? 'some' : 'one', name }
}
const routeFits = (route: string) =>
  route
    .split('/')
    .filter(Boolean)
    .map((segment): Fit => {
      const { kind, name } = routeSegment(segment)
      return kind === 'static'
        ? { ...ONE, text: name }
        : kind === 'one'
          ? ONE
          : { min: kind === 'some' ? 1 : 0, max: Infinity }
    })
// a destination's segments from its own parse, so / and a trailing slash read as they do for a route: a param that's
// a whole segment stands for as many as its modifier says (:x* any, :x+ one or more, :x? none or one), one in a
// segment with text stands for that one segment, and text alone is itself
const destinationFits = (destination: string) => {
  const segments: Part[][] = [[]]
  for (const part of parse(destination)) {
    if (typeof part === 'string') {
      part.split('/').forEach((piece, i) => {
        if (i) segments.push([])
        if (piece) segments.at(-1)!.push(piece)
      })
      continue
    }
    if (part.prefix === '/' || (part.group && part.prefix.startsWith('/'))) segments.push([])
    segments.at(-1)!.push(part)
  }
  return segments
    .filter((segment) => segment.length)
    .map((segment): Fit => {
      const [only] = segment
      if (segment.length === 1 && typeof only !== 'string') {
        // a {group} of plain text, there or not
        if (!only!.pattern)
          return {
            min: only!.modifier ? 0 : 1,
            max: 1,
            text: (only!.prefix + only!.suffix).replace(/^\//, ''),
          }
        const many = only!.modifier === '+' || only!.modifier === '*'
        return {
          min: only!.modifier === '?' || only!.modifier === '*' ? 0 : 1,
          max: many ? Infinity : 1,
        }
      }
      return segment.every((piece) => typeof piece === 'string')
        ? { ...ONE, text: segment.join('') }
        : ONE
    })
}

// whether some value of a destination's params is a url the route answers. lenient on purpose: /x/:tab can render
// app/x/versions, so it only rules out a destination no value could fit (a typo, a missing or extra segment). a
// segment that stands for a run, on either side, takes as many of the other side's as it can
const fits = (dest: Fit[], route: Fit[]): boolean => {
  if (!dest.length || !route.length)
    return [...dest, ...route].every((segment) => segment.min === 0)
  const [d, ...dRest] = dest as [Fit, ...Fit[]]
  const [r, ...rRest] = route as [Fit, ...Fit[]]
  const run = (segment: Fit, rest: Fit[], other: Fit[], next: (n: number) => boolean) => {
    for (let n = segment.min; n <= Math.min(segment.max, other.length); n += 1)
      if (next(n)) return true
    return false
  }
  if (r.min !== 1 || r.max !== 1) return run(r, rRest, dest, (n) => fits(dest.slice(n), rRest))
  if (d.min !== 1 || d.max !== 1) return run(d, dRest, route, (n) => fits(dRest, route.slice(n)))
  return (d.text === undefined || r.text === undefined || d.text === r.text) && fits(dRest, rRest)
}

// md({ aliases }) checked when the config loads, so a mistake fails next dev and next build, not a request
export const checkAliases = (aliases: Record<string, string>, pages: string[]) => {
  let unchecked = false
  for (const [source, destination] of Object.entries(aliases)) {
    const alias = `md({ aliases }): '${source}': '${destination}'`
    const fail = (why: string) => {
      throw new TypeError(`[affordances-md] ${alias} ${why}`)
    }
    if (!source.startsWith('/'))
      fail("has a source that isn't a path. Start it with /, as in a rewrite's source.")
    // a ? that makes a param optional is fine; any other starts a query, which an alias has no use for
    const optionalMarks = /(:\w+(?:\([^)]*\))?|\})\?(?=\/|$)/g
    if (!/^\/(?!\/)/.test(destination) || /[?#]/.test(destination.replace(optionalMarks, '$1')))
      fail(
        "has a destination that isn't a path on this site. An alias names the app/ route a public url renders, as a path with the source's params: '/package/@:scope/:name': '/package/@:scope%2F:name'.",
      )
    try {
      sourceRegex(source)
      sourceRegex(destination)
    } catch (error) {
      fail(`isn't valid Next rewrite syntax: ${(error as Error).message}`)
    }
    const known = new Set(sourceParams(source))
    const unknown = sourceParams(destination).filter((name) => !known.has(name))
    if (unknown.length)
      fail(
        `uses ${unknown.map((name) => `:${name}`).join(', ')} in its destination, which the source doesn't have. Name each param in the source, the way a rewrite does.`,
      )
    // without app/ (a wrong root, or a node without process.getBuiltinModule) there's nothing to check against,
    // which scanApp has said already: the alias is used as it is
    if (!pages.length) {
      unchecked = true
      continue
    }
    const dest = destinationFits(destination)
    if (!pages.some((route) => fits(dest, routeFits(route)))) {
      // the pages that share the most leading segments with it, as a pointer to what was meant
      const shared = (route: string) => {
        const segments = routeFits(route)
        let n = 0
        while (n < dest.length && segments[n] && fits([dest[n]!], [segments[n]!])) n += 1
        return n
      }
      const best = Math.max(0, ...pages.map(shared))
      const near = pages.filter((route) => best && shared(route) === best).slice(0, 3)
      fail(
        `renders no page in app/: no page.tsx answers ${destination}.${near.length ? ` The nearest page${near.length > 1 ? 's are' : ' is'} ${near.map((route) => `app${route === '/' ? '' : route}/page.tsx`).join(', ')}.` : ''} The destination is the url your proxy.ts or rewrites send the source to, with a param where the route has a [segment]: '/package/@:scope/:name': '/package/@:scope%2F:name' for app/package/[pkg]/page.tsx.`,
      )
    }
  }
  if (unchecked)
    console.warn(
      "[affordances-md] md({ aliases }) can't check that each alias renders a page, since it found no pages in app/, so they're used as they are.",
    )
}

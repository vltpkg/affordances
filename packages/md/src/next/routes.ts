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

// a list md() passed through next's env, or none when it didn't run (withMd left out, or a test)
const strings = (raw: string | undefined): string[] => {
  try {
    const list: unknown = JSON.parse(raw ?? '[]')
    return Array.isArray(list) ? list.filter((item) => typeof item === 'string') : []
  } catch {
    return []
  }
}

// the routes md() found. spelled out: next inlines process.env.NAME, never process.env[name]
export const builtPages = (): string[] => strings(process.env.AFFORDANCES_MD_ROUTES)

// path-to-regexp names are word characters: [product-id] → :productid
const param = (name: string) => name.replace(/\W/g, '')

// /products/[slug] → /products/:slug, the path-to-regexp form next's headers() matches
export const toSource = (route: string) =>
  route
    .replace(/\[\[\.\.\.([^\]]+)\]\]/g, (_, name: string) => `:${param(name)}*`)
    .replace(/\[\.\.\.([^\]]+)\]/g, (_, name: string) => `:${param(name)}+`)
    .replace(/\[([^\]]+)\]/g, (_, name: string) => `:${param(name)}`)

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

type Part = string | { prefix: string; suffix: string; pattern: string; modifier: string }

// path-to-regexp 6's parse, with next's delimiter '/'
const parse = (source: string): Part[] => {
  const tokens = lex(source)
  const parts: Part[] = []
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
        prefix,
        suffix: '',
        pattern: pattern ?? safe(prefix),
        modifier: take('modifier') ?? '',
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
        prefix,
        suffix,
        pattern: named && !own ? safe(prefix) : own,
        modifier: take('modifier') ?? '',
      })
      continue
    }
    must('end')
  }
  return parts
}

// a next source as a regex over a pathname, as next's own matcher builds it (path-to-regexp 6, case-insensitive).
// throws on a source next would reject too
export const sourceRegex = (source: string) => {
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
  return new RegExp(`^${body}$`, 'i')
}

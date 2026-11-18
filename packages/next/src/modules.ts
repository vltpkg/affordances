import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { parseSync } from 'oxc-parser'
import { byCodeUnit, findAppDir } from './codegen.ts'
import type { Diagnostic } from './diagnostics.ts'
import { freeIdentifiers, SCHEMA_LIBRARIES } from './slice.ts'

// RFC 0005 §1's capability modules: where they are, and what they may hold, checked statically with oxc before
// anything is evaluated. A module is data: it may import the authoring API, a schema library and other capability
// modules, and nothing else; it may not reach the environment, the network or the clock; and it may not use syntax
// Node's type stripping can't erase. Each finding is a diagnostic, never a throw

/** @experimental The file a capability module is, and its siblings that would be one if they could be erased. */
export const MODULE = 'capabilities.ts'
const NOT_ERASABLE = ['capabilities.tsx', 'capabilities.js', 'capabilities.jsx', 'capabilities.mts']
// the authoring API a module may import, besides the schema libraries
const AUTHORING = ['@affordances/ir', '@affordances/next/author']
// the globals a module may read: values that are the same on every machine and at every moment. Anything else free is
// ambient (RFC 0005 §1): an allowlist, as the slice's, since a denylist let globalThis.process.platform and Intl's time
// zone through (review of 299c02d4). Math is a value, but Math.random is checked as a member
const VALUE_GLOBALS = new Set([
  'undefined',
  'NaN',
  'Infinity',
  'Number',
  'String',
  'Boolean',
  'BigInt',
  'Symbol',
  'Array',
  'Object',
  'RegExp',
  'JSON',
  'Map',
  'Set',
  'WeakMap',
  'WeakSet',
  'Error',
  'TypeError',
  'RangeError',
  'Math',
  'parseInt',
  'parseFloat',
  'isNaN',
  'isFinite',
])

type Node = { type: string; start: number; end: number; [key: string]: unknown }

/** @experimental Every capability module under the app dir, by the walk codegen does, and the files that can't be. */
export const findModules = (root: string): { modules: string[]; diagnostics: Diagnostic[] } => {
  const modules: string[] = []
  const diagnostics: Diagnostic[] = []
  const walk = (dir: string) => {
    for (const name of NOT_ERASABLE)
      if (existsSync(path.join(dir, name)))
        diagnostics.push({
          code: 'E_CAPABILITY_SYNTAX',
          file: path.relative(root, path.join(dir, name)),
          subject: name,
          detail: `a capability module is ${MODULE}: rename it, since only one extension is read`,
        })
    if (existsSync(path.join(dir, MODULE))) modules.push(path.join(dir, MODULE))
    for (const child of readdirSync(dir, { withFileTypes: true }))
      // a _private folder's capabilities.ts is never a module itself (RFC 0005 §1)
      if (child.isDirectory() && !child.name.startsWith('_') && child.name !== 'node_modules')
        walk(path.join(dir, child.name))
  }
  walk(findAppDir(root))
  return { modules: modules.toSorted(byCodeUnit), diagnostics }
}

// a string literal's end in JSON text: the index of its closing quote, past any escapes
const stringEnd = (text: string, start: number) => {
  let i = start + 1
  while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1
  return i
}

// tsconfig's JSONC as JSON, in two passes outside strings, since a string holds globs like "**/*.ts" and URLs that a
// plain regex reads as comments (hosting-lab's real build, 2026-11-18): comments first, so a trailing comma followed
// by a comment is still seen as trailing (review of 65d47ddb), then trailing commas
export const jsonc = (source: string): unknown => {
  // a leading byte order mark, which tsc accepts (review of 9f30e30c)
  const text = source.startsWith('\uFEFF') ? source.slice(1) : source
  let bare = ''
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') {
      const end = stringEnd(text, i)
      bare += text.slice(i, end + 1)
      i = end
    } else if (text.startsWith('//', i)) {
      const end = text.indexOf('\n', i)
      i = end === -1 ? text.length : end - 1
    } else if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2)
      if (end === -1) throw new SyntaxError('an unterminated /* comment')
      bare += ' '
      i = end + 1
    } else bare += text[i]
  }
  let json = ''
  for (let i = 0; i < bare.length; i++) {
    if (bare[i] === '"') {
      const end = stringEnd(bare, i)
      json += bare.slice(i, end + 1)
      i = end
    } else if (bare[i] === ',' && /^\s*[}\]]/.test(bare.slice(i + 1))) continue
    else json += bare[i]
  }
  return JSON.parse(json)
}

type TsConfig = {
  extends?: string
  compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> }
}

type Alias = { prefix: string; targets: string[] }

/** @experimental The app's paths aliases, as TypeScript reads them, and the config it couldn't read, if any. */
export const readAliases = (
  root: string,
): { aliases: Alias[]; unreadable?: { file: string; detail: string } } => {
  // tsconfig.json, else jsconfig.json, as Next reads them; then each config it extends by a relative path. As in tsc,
  // the nearest config that sets paths or baseUrl wins for each, and paths resolve against baseUrl when there is one,
  // else against the directory of the config that sets them
  const first = ['tsconfig.json', 'jsconfig.json']
    .map((f) => path.join(root, f))
    .find((f) => existsSync(f))
  let paths: { value: Record<string, string[]>; dir: string } | undefined
  let baseUrl: string | undefined
  const seen = new Set<string>()
  for (let file = first; file;) {
    if (seen.has(file)) break
    seen.add(file)
    let config: TsConfig
    try {
      config = jsonc(readFileSync(file, 'utf8')) as TsConfig
    } catch (error) {
      return {
        aliases: [],
        unreadable: { file: path.relative(root, file), detail: (error as Error).message },
      }
    }
    const options = config.compilerOptions
    if (options?.paths && !paths) paths = { value: options.paths, dir: path.dirname(file) }
    if (options?.baseUrl !== undefined && baseUrl === undefined)
      baseUrl = path.resolve(path.dirname(file), options.baseUrl)
    if (!config.extends?.startsWith('.')) break
    const extended = path.resolve(path.dirname(file), config.extends)
    file = extended.endsWith('.json') ? extended : `${extended}.json`
    if (!existsSync(file))
      return {
        aliases: [],
        unreadable: {
          file: path.relative(root, file),
          detail: 'the config it extends doesn’t exist',
        },
      }
  }
  if (!paths) return { aliases: [] }
  const base = baseUrl ?? paths.dir
  return {
    aliases: Object.entries(paths.value).map(([key, targets]) => ({
      prefix: key.replace(/\*$/, ''),
      targets: targets.map((t) => path.resolve(base, t.replace(/\*$/, ''))),
    })),
  }
}

// the app's paths aliases, for aliased imports (`@/x`), as Next resolves them; compileSync reports an unreadable config
export const aliasesOf = (root: string): Alias[] => readAliases(root).aliases

// the files an import could name, in Node's and TypeScript's order of extensions
const candidates = (base: string) =>
  [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, path.join(base, 'index.ts')].filter((f) =>
    existsSync(f),
  )

/** @experimental Where an import in a module resolves to, if it's a file of the app, by relative path or alias. */
export const resolveImport = (root: string, from: string, source: string): string | undefined => {
  if (source.startsWith('.')) return candidates(path.resolve(path.dirname(from), source))[0]
  for (const { prefix, targets } of aliasesOf(root))
    if (source.startsWith(prefix))
      for (const t of targets) {
        const found = candidates(path.join(t, source.slice(prefix.length)))[0]
        if (found) return found
      }
  return undefined
}

const allowedPackage = (source: string) =>
  [...AUTHORING, ...SCHEMA_LIBRARIES].some((lib) => source === lib || source.startsWith(`${lib}/`))

/** @experimental One module's static checks: its imports, what it reaches, and its syntax (RFC 0005 §1). */
export const checkModule = (
  root: string,
  file: string,
  source = readFileSync(file, 'utf8'),
): Diagnostic[] => {
  const rel = path.relative(root, file)
  const out: Diagnostic[] = []
  const lineOf = (offset: number) => source.slice(0, offset).split('\n').length
  const { program, errors } = parseSync(file, source)
  if (errors.length) {
    out.push({
      code: 'E_CAPABILITY_SYNTAX',
      file: rel,
      subject: 'parse',
      detail: errors[0]!.message,
    })
    return out
  }
  const body = program.body as unknown as Node[]
  const top = new Set<string>()

  // what it imports, and re-exports from
  for (const node of body) {
    const from = (node.source as Node | null | undefined)?.value as string | undefined
    if (node.type === 'ImportDeclaration')
      for (const s of node.specifiers as Node[]) top.add((s.local as Node).name as string)
    if (from === undefined) continue
    if (
      node.type !== 'ImportDeclaration' &&
      node.type !== 'ExportNamedDeclaration' &&
      node.type !== 'ExportAllDeclaration'
    )
      continue
    // a type-only import is erased, so it imports nothing at run time
    const specifiers = (node.specifiers as Node[] | undefined) ?? []
    const typeOnly =
      node.importKind === 'type' ||
      node.exportKind === 'type' ||
      (specifiers.length > 0 &&
        specifiers.every((s) => s.importKind === 'type' || s.exportKind === 'type'))
    if (typeOnly || allowedPackage(from)) continue
    const target = resolveImport(root, file, from)
    if (target && path.basename(target) === MODULE) continue
    out.push({
      code: 'E_CAPABILITY_IMPORT',
      file: rel,
      line: lineOf(node.start),
      subject: from,
      detail: target
        ? `${path.relative(root, target)} is application code, not a capability module`
        : `'${from}' isn't the authoring API, a schema library or a capability module`,
    })
  }

  // syntax Node can't erase, wherever it is
  const visitSyntax = (n: unknown): void => {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) return n.forEach(visitSyntax)
    const node = n as Node
    const construct =
      node.type === 'TSEnumDeclaration'
        ? 'an enum'
        : node.type === 'TSModuleDeclaration'
          ? 'a namespace'
          : node.type === 'TSImportEqualsDeclaration'
            ? 'import ='
            : node.type === 'TSParameterProperty'
              ? 'a parameter property'
              : undefined
    if (construct)
      out.push({
        code: 'E_CAPABILITY_SYNTAX',
        file: rel,
        line: lineOf(node.start),
        subject: construct,
        detail: construct === 'an enum' ? 'use a const object and z.enum instead' : undefined,
      })
    for (const [k, v] of Object.entries(node))
      if (k !== 'type' && k !== 'start' && k !== 'end') visitSyntax(v)
  }
  visitSyntax(body)

  // the ambient reads: with the module's own top-level names in scope, so a local binding named Date isn't one
  for (const node of body) {
    const d = node.type.startsWith('Export') ? ((node.declaration as Node | null) ?? node) : node
    if (d.type === 'VariableDeclaration')
      for (const v of d.declarations as Node[])
        if ((v.id as Node).type === 'Identifier') top.add((v.id as Node).name as string)
    if ((d.type === 'FunctionDeclaration' || d.type === 'ClassDeclaration') && d.id)
      top.add((d.id as Node).name as string)
  }
  // what in the module can read a value: not its imports, and not an export's specifiers, whose names are exported, not
  // read; an export's own declaration, or its default expression, can
  const readers = body.flatMap((n): Node[] =>
    n.type === 'ImportDeclaration' || n.type === 'ExportAllDeclaration'
      ? []
      : n.type === 'ExportNamedDeclaration'
        ? n.declaration
          ? [n.declaration as Node]
          : []
        : n.type === 'ExportDefaultDeclaration'
          ? [n.declaration as Node]
          : [n],
  )
  const { free, banned } = freeIdentifiers(
    {
      type: 'Program',
      start: 0,
      end: source.length,
      body: readers,
    },
    [top],
  )
  const seen = new Set<string>()
  const ambient = (what: string, at: number) => {
    if (seen.has(what)) return
    seen.add(what)
    out.push({ code: 'E_CAPABILITY_AMBIENT', file: rel, line: lineOf(at), subject: what })
  }
  for (const b of banned) if (b === 'a dynamic import()') ambient('import()', 0)
  for (const { name, node } of free) if (!VALUE_GLOBALS.has(name)) ambient(name, node.start)
  // Math.random, read as a member: Math itself is a value global
  const visitMath = (n: unknown): void => {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) return n.forEach(visitMath)
    const node = n as Node
    if (
      node.type === 'MemberExpression' &&
      (node.object as Node).type === 'Identifier' &&
      (node.object as Node).name === 'Math' &&
      !top.has('Math') &&
      ((node.property as Node).name === 'random' || (node.property as Node).value === 'random')
    )
      ambient('Math.random', node.start)
    for (const [k, v] of Object.entries(node))
      if (k !== 'type' && k !== 'start' && k !== 'end') visitMath(v)
  }
  visitMath(body)
  return out
}

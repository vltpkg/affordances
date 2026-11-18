import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseSync } from 'oxc-parser'

// RFC 0005 §2.1's slice rule for E3: an action's input schema is a runtime value, and evaluating actions.ts would run
// the app. So only the slice is evaluated: the input initializer and the bindings it reaches, followed transitively,
// each of which must be a schema-library import, a type-only import, a const whose own initializer holds, or an import
// of another module whose slice holds (to a depth of 4). Anything else (app code, a let, a function, an unknown
// global, an ambient read) makes the input opaque, before anything is evaluated. The slice that holds is written out
// on its own and evaluated in a child process with an empty environment, then converted to JSON Schema. Nothing here
// throws on author input: every outcome is a result

/** The schema libraries a slice may import (RFC 0005 §2.1), by package, with their subpaths. */
export const SCHEMA_LIBRARIES = [
  'zod',
  'valibot',
  'arktype',
  '@sinclair/typebox',
  'typebox',
  'effect',
  '@effect/schema',
]
// what survives evaluation but not JSON Schema, so the IR's schema would accept what the app's rejects
export const LOSSY = [
  'refine',
  'superRefine',
  'transform',
  'preprocess',
  'custom',
  'check',
  'overwrite',
]
export const MAX_DEPTH = 4
// globals a schema may read: values, never ambient state (process, Date, Math, crypto are not here)
const GLOBALS = new Set([
  'undefined',
  'NaN',
  'Infinity',
  'Number',
  'String',
  'Boolean',
  'BigInt',
  'Array',
  'Object',
  'RegExp',
  'JSON',
])

export type SliceResult =
  | { status: 'converted'; schema: Record<string, unknown>; lossy: string[] }
  | { status: 'opaque'; reason: string }

type Node = { type: string; start: number; end: number; [key: string]: unknown }

type Binding =
  | { kind: 'library'; source: string; imported: string }
  | { kind: 'type' }
  | { kind: 'relative'; source: string; imported: string }
  | { kind: 'const'; declarator: Node }
  | { kind: 'other'; what: string }

type Module = {
  file: string
  source: string
  bindings: Map<string, Binding>
  // exported name to the local binding it names, or to a re-export
  exports: Map<string, { local: string } | { source: string; imported: string }>
}

const isLibrary = (source: string) =>
  SCHEMA_LIBRARIES.some((lib) => source === lib || source.startsWith(`${lib}/`))

class Opaque extends Error {}

const parseModule = (file: string, source: string): Module => {
  const { program, errors } = parseSync(file, source)
  if (errors.length) throw new Opaque(`${file} doesn't parse: ${errors[0]!.message}`)
  const bindings = new Map<string, Binding>()
  const exports: Module['exports'] = new Map()
  const names = (pattern: Node): string[] =>
    pattern.type === 'Identifier'
      ? [pattern.name as string]
      : pattern.type === 'ObjectPattern'
        ? (pattern.properties as Node[]).flatMap((p) =>
            names((p.type === 'RestElement' ? p.argument : p.value) as Node),
          )
        : pattern.type === 'ArrayPattern'
          ? (pattern.elements as (Node | null)[]).flatMap((e) => (e ? names(e) : []))
          : pattern.type === 'AssignmentPattern'
            ? names(pattern.left as Node)
            : pattern.type === 'RestElement'
              ? names(pattern.argument as Node)
              : []
  const declare = (node: Node) => {
    if (node.type === 'VariableDeclaration') {
      for (const d of node.declarations as Node[])
        for (const n of names(d.id as Node))
          bindings.set(
            n,
            node.kind === 'const'
              ? { kind: 'const', declarator: d }
              : { kind: 'other', what: `a ${node.kind as string}` },
          )
      return
    }
    const id = node.id as Node | null | undefined
    if (id?.type !== 'Identifier') return
    const name = id.name as string
    // a type alias or interface is erased; an enum is a runtime value, so it isn't
    if (node.type === 'TSTypeAliasDeclaration' || node.type === 'TSInterfaceDeclaration')
      bindings.set(name, { kind: 'type' })
    else
      bindings.set(name, {
        kind: 'other',
        what:
          node.type === 'FunctionDeclaration'
            ? 'a function'
            : node.type === 'ClassDeclaration'
              ? 'a class'
              : node.type === 'TSEnumDeclaration'
                ? 'an enum'
                : 'a declaration',
      })
  }
  for (const node of program.body as unknown as Node[]) {
    if (node.type === 'ImportDeclaration') {
      const from = (node.source as Node).value as string
      const typeOnly = node.importKind === 'type'
      for (const s of node.specifiers as Node[]) {
        const local = (s.local as Node).name as string
        if (typeOnly || s.importKind === 'type') {
          bindings.set(local, { kind: 'type' })
          continue
        }
        const imported =
          s.type === 'ImportDefaultSpecifier'
            ? 'default'
            : s.type === 'ImportNamespaceSpecifier'
              ? '*'
              : (((s.imported as Node).name ?? (s.imported as Node).value) as string)
        bindings.set(
          local,
          isLibrary(from)
            ? { kind: 'library', source: from, imported }
            : from.startsWith('.')
              ? { kind: 'relative', source: from, imported }
              : { kind: 'other', what: `an import from '${from}', which isn't a schema library` },
        )
      }
      continue
    }
    if (node.type === 'ExportNamedDeclaration') {
      const declaration = node.declaration as Node | null
      if (declaration) {
        declare(declaration)
        const declared =
          declaration.type === 'VariableDeclaration'
            ? (declaration.declarations as Node[]).flatMap((d) => names(d.id as Node))
            : (declaration.id as Node | null)?.type === 'Identifier'
              ? [(declaration.id as Node).name as string]
              : []
        for (const n of declared) exports.set(n, { local: n })
      }
      const from = (node.source as Node | null)?.value as string | undefined
      for (const s of (node.specifiers as Node[]) ?? []) {
        const exported = ((s.exported as Node).name ?? (s.exported as Node).value) as string
        const local = ((s.local as Node).name ?? (s.local as Node).value) as string
        exports.set(exported, from ? { source: from, imported: local } : { local })
      }
      continue
    }
    if (node.type === 'ExportDefaultDeclaration') {
      const d = node.declaration as Node
      if (d.type === 'Identifier') exports.set('default', { local: d.name as string })
      continue
    }
    declare(node)
  }
  return { file, source, bindings, exports }
}

// the free identifiers an expression reads, with nested functions' parameters and locals in scope, and type
// positions skipped. Also returns what can't be in a slice whatever it reads: import(), import.meta
// members that reach the language's machinery rather than a schema: Object.constructor('return process')() would
// read the environment through a value global (review of aef81dc1)
const BANNED_MEMBERS = new Set([
  'constructor',
  '__proto__',
  'prototype',
  // the reflection that reaches the same machinery through a value global (review of bab4b5cf)
  'getOwnPropertyDescriptor',
  'getOwnPropertyDescriptors',
  'getPrototypeOf',
  'setPrototypeOf',
  'defineProperty',
  'defineProperties',
])
const TYPE_KEYS = new Set([
  'typeAnnotation',
  'returnType',
  'typeParameters',
  'typeArguments',
  'superTypeParameters',
])
const WRAPPERS = new Set([
  'TSAsExpression',
  'TSSatisfiesExpression',
  'TSNonNullExpression',
  'TSInstantiationExpression',
])

const freeIdentifiers = (root: Node) => {
  const free: { name: string; node: Node }[] = []
  const banned: string[] = []
  const calls: Node[] = []
  const patternNames = (p: Node | null | undefined, into: Set<string>) => {
    if (!p) return
    if (p.type === 'Identifier') into.add(p.name as string)
    else if (p.type === 'ObjectPattern')
      for (const q of p.properties as Node[])
        patternNames((q.type === 'RestElement' ? q.argument : q.value) as Node, into)
    else if (p.type === 'ArrayPattern')
      for (const e of p.elements as (Node | null)[]) patternNames(e, into)
    else if (p.type === 'AssignmentPattern') patternNames(p.left as Node, into)
    else if (p.type === 'RestElement') patternNames(p.argument as Node, into)
  }
  // the expressions inside a binding pattern: each default, and each computed key, at any depth. They run when the
  // binding does, so they're read as the initializer is (review of aef81dc1)
  const patternExpressions = (p: Node | null | undefined): Node[] => {
    if (!p) return []
    if (p.type === 'AssignmentPattern')
      return [p.right as Node, ...patternExpressions(p.left as Node)]
    if (p.type === 'ObjectPattern')
      return (p.properties as Node[]).flatMap((q) =>
        q.type === 'RestElement'
          ? patternExpressions(q.argument as Node)
          : [...(q.computed ? [q.key as Node] : []), ...patternExpressions(q.value as Node)],
      )
    if (p.type === 'ArrayPattern')
      return (p.elements as (Node | null)[]).flatMap((e) => patternExpressions(e))
    if (p.type === 'RestElement') return patternExpressions(p.argument as Node)
    return []
  }
  // a computed key: a literal is a name like any other; anything else could name anything
  const computedKey = (k: Node) => {
    if (k.type === 'Literal') {
      if (BANNED_MEMBERS.has(String(k.value))) banned.push(`the ${String(k.value)} property`)
      return
    }
    if (k.type === 'TemplateLiteral' && (k.expressions as Node[]).length === 0) return
    banned.push('a computed key that isn’t a literal')
  }
  const hoisted = (body: Node[]) => {
    const s = new Set<string>()
    for (const n of body) {
      if (n.type === 'VariableDeclaration')
        for (const d of n.declarations as Node[]) patternNames(d.id as Node, s)
      else if ((n.type === 'FunctionDeclaration' || n.type === 'ClassDeclaration') && n.id)
        s.add((n.id as Node).name as string)
    }
    return s
  }
  const visit = (n: unknown, scope: Set<string>[]): void => {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) {
      for (const x of n) visit(x, scope)
      return
    }
    const node = n as Node
    if (typeof node.type !== 'string') return
    if (WRAPPERS.has(node.type)) return visit(node.expression, scope)
    if (node.type.startsWith('TS')) return
    switch (node.type) {
      case 'Identifier':
        if (!scope.some((s) => s.has(node.name as string)))
          free.push({ name: node.name as string, node })
        return
      case 'MemberExpression':
        visit(node.object, scope)
        if (node.computed) {
          computedKey(node.property as Node)
          visit(node.property, scope)
        } else if (BANNED_MEMBERS.has((node.property as Node).name as string))
          banned.push(`the ${(node.property as Node).name as string} property`)
        return
      case 'Property':
        if (node.computed) {
          computedKey(node.key as Node)
          visit(node.key, scope)
        }
        visit(node.value, scope)
        return
      case 'MethodDefinition':
      case 'PropertyDefinition':
        if (node.computed) visit(node.key, scope)
        visit(node.value, scope)
        return
      case 'LabeledStatement':
        return visit(node.body, scope)
      case 'BreakStatement':
      case 'ContinueStatement':
        return
      case 'ImportExpression':
        banned.push('a dynamic import()')
        return
      case 'MetaProperty':
        banned.push('import.meta')
        return
      case 'CallExpression':
        calls.push(node)
        break
      case 'ArrowFunctionExpression':
      case 'FunctionExpression':
      case 'FunctionDeclaration': {
        const s = new Set<string>()
        if (node.id) s.add((node.id as Node).name as string)
        for (const p of node.params as Node[]) patternNames(p, s)
        const inner = [...scope, s]
        visit((node.params as Node[]).flatMap(patternExpressions), inner)
        const body = node.body as Node
        if (body.type === 'BlockStatement') inner.push(hoisted(body.body as Node[]))
        visit(body.type === 'BlockStatement' ? body.body : body, inner)
        return
      }
      case 'BlockStatement':
        return visit(node.body, [...scope, hoisted(node.body as Node[])])
      case 'CatchClause': {
        const s = new Set<string>()
        patternNames(node.param as Node, s)
        visit(patternExpressions(node.param as Node), [...scope, s])
        return visit(node.body, [...scope, s])
      }
      case 'VariableDeclarator':
        visit(patternExpressions(node.id as Node), scope)
        return visit(node.init, scope)
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'type' || key === 'start' || key === 'end' || TYPE_KEYS.has(key)) continue
      visit(value, scope)
    }
  }
  visit(root, [])
  return { free, banned, calls }
}

const resolveFile = (from: string, source: string): string | undefined => {
  const base = path.resolve(path.dirname(from), source)
  const candidates = /\.[mc]?[jt]sx?$/.test(source)
    ? [base, base.replace(/\.js$/, '.ts'), base.replace(/\.mjs$/, '.mts')]
    : ['.ts', '.mts', '.js', '.mjs', '/index.ts', '/index.js'].map((ext) => base + ext)
  return candidates.find((f) => existsSync(f))
}

type Needed = { module: Module; locals: Set<string> }

// the slice: every module it reaches, with the locals it needs from each; or why it doesn't hold
export const planSlice = (file: string, source: string, input: Node) => {
  const modules = new Map<string, Needed>()
  const lossy = new Set<string>()
  const parsed = new Map<string, Module>()
  const moduleOf = (f: string, text?: string) => {
    let m = parsed.get(f)
    if (!m) {
      m = parseModule(f, text ?? readFileSync(f, 'utf8'))
      parsed.set(f, m)
    }
    return m
  }
  const visited = new Set<string>()
  const needed = (m: Module) => {
    let n = modules.get(m.file)
    if (!n) {
      n = { module: m, locals: new Set() }
      modules.set(m.file, n)
    }
    return n
  }
  // an expression in module m, at depth: every name it reads must be in the slice
  const expression = (m: Module, node: Node, depth: number) => {
    const { free, banned, calls } = freeIdentifiers(node)
    if (banned.length) throw new Opaque(`${m.file} uses ${banned[0]}`)
    for (const call of calls) {
      const callee = call.callee as Node
      const name =
        callee.type === 'MemberExpression' && !callee.computed
          ? ((callee.property as Node).name as string)
          : callee.type === 'Identifier'
            ? (() => {
                const b = m.bindings.get(callee.name as string)
                return b?.kind === 'library' ? b.imported : undefined
              })()
            : undefined
      if (!name) continue
      if (LOSSY.includes(name)) lossy.add(name)
      if (
        name === 'pipe' &&
        (call.arguments as Node[]).some(
          (a) => a.type === 'ArrowFunctionExpression' || a.type === 'FunctionExpression',
        )
      )
        lossy.add('pipe')
    }
    for (const { name } of free) local(m, name, depth)
  }
  const local = (m: Module, name: string, depth: number) => {
    const key = `${m.file}\0${name}`
    if (visited.has(key)) return
    visited.add(key)
    const b = m.bindings.get(name)
    if (!b) {
      if (GLOBALS.has(name)) return
      throw new Opaque(
        `${m.file} reads ${name}, which isn't a schema-library import, a const or a value global`,
      )
    }
    switch (b.kind) {
      case 'type':
        return
      case 'library':
        needed(m).locals.add(name)
        return
      case 'other':
        throw new Opaque(`${m.file}'s ${name} is ${b.what}`)
      case 'const':
        needed(m).locals.add(name)
        // the whole declarator: its initializer, and its pattern's defaults and computed keys
        expression(m, b.declarator, depth)
        return
      case 'relative': {
        if (depth + 1 > MAX_DEPTH)
          throw new Opaque(`${m.file} imports ${b.source} beyond a depth of ${MAX_DEPTH}`)
        const target = resolveFile(m.file, b.source)
        if (!target)
          throw new Opaque(
            `${m.file} imports ${b.source}, which doesn't resolve to a .ts or .js file`,
          )
        needed(m).locals.add(name)
        const t = moduleOf(target)
        if (b.imported === '*') throw new Opaque(`${m.file} imports ${b.source} as a namespace`)
        exported(t, b.imported, depth + 1)
        return
      }
    }
  }
  const exported = (m: Module, name: string, depth: number) => {
    const e = m.exports.get(name)
    if (!e) throw new Opaque(`${m.file} doesn't export ${name}`)
    if ('local' in e) {
      local(m, e.local, depth)
      needed(m).locals.add(e.local)
      return
    }
    if (depth + 1 > MAX_DEPTH)
      throw new Opaque(`${m.file} re-exports ${e.source} beyond a depth of ${MAX_DEPTH}`)
    const target = resolveFile(m.file, e.source)
    if (!target) throw new Opaque(`${m.file} re-exports ${e.source}, which doesn't resolve`)
    // a module that only re-exports is still in the slice: its importer imports it
    needed(m)
    exported(moduleOf(target), e.imported, depth + 1)
  }
  try {
    const entry = moduleOf(file, source)
    needed(entry)
    expression(entry, input, 0)
    return { status: 'slice' as const, entry: file, input, modules, lossy: [...lossy].toSorted() }
  } catch (error) {
    if (error instanceof Opaque) return { status: 'opaque' as const, reason: error.message }
    throw error
  }
}

type Plan = Extract<ReturnType<typeof planSlice>, { status: 'slice' }>

// the slice's own modules: each reached module's needed imports and consts, in source order, and its exports
const emit = (plan: Plan, dir: string) => {
  const nameOf = new Map<string, string>()
  let i = 0
  for (const f of plan.modules.keys()) nameOf.set(f, `m${i++}.ts`)
  for (const [file, { module: m, locals }] of plan.modules) {
    const lines: string[] = []
    for (const name of locals) {
      const b = m.bindings.get(name)!
      if (b.kind === 'library')
        lines.push(
          b.imported === '*'
            ? `import * as ${name} from ${JSON.stringify(b.source)}`
            : b.imported === 'default'
              ? `import ${name} from ${JSON.stringify(b.source)}`
              : `import { ${JSON.stringify(b.imported)} as ${name} } from ${JSON.stringify(b.source)}`,
        )
      else if (b.kind === 'relative') {
        const target = resolveFile(file, b.source)!
        lines.push(
          `import { ${JSON.stringify(b.imported)} as ${name} } from './${nameOf.get(target)}'`,
        )
      }
    }
    // the consts, each once, in source order, so a declaration reads only what came before it, as in the source
    const declarators = [
      ...new Set([...locals].map((n) => m.bindings.get(n)).filter((b) => b?.kind === 'const')),
    ]
      .map((b) => (b as Extract<Binding, { kind: 'const' }>).declarator)
      .toSorted((a, b) => a.start - b.start)
    for (const d of declarators) lines.push(`const ${m.source.slice(d.start, d.end)}`)
    for (const [exportedName, e] of m.exports)
      if ('local' in e && locals.has(e.local))
        lines.push(`export { ${e.local} as ${JSON.stringify(exportedName)} }`)
      else if (!('local' in e)) {
        const target = resolveFile(file, e.source)
        if (target && plan.modules.has(target))
          lines.push(
            `export { ${JSON.stringify(e.imported)} as ${JSON.stringify(exportedName)} } from './${nameOf.get(target)}'`,
          )
      }
    if (file === plan.entry)
      lines.push(`export default (${m.source.slice(plan.input.start, plan.input.end)})`)
    writeFileSync(path.join(dir, nameOf.get(file)!), `${lines.join('\n')}\n`)
  }
  return path.join(dir, nameOf.get(plan.entry)!)
}

// the child's program: import the slice, confirm a Standard Schema, convert it as authoring does (ir/author/standard.ts)
const RUNNER = `
const entry = process.argv[2]
const out = (v) => process.stdout.write(JSON.stringify(v))
try {
  const schema = (await import(entry)).default
  const standard = schema?.['~standard']
  if (!standard || standard.version !== 1) out({ error: "the input isn't a Standard Schema" })
  else if (!standard.jsonSchema) out({ error: 'this schema (' + standard.vendor + ") can't produce JSON Schema" })
  else {
    const { $schema, ...rest } = standard.jsonSchema.input({ target: 'draft-2020-12' })
    out({ schema: rest })
  }
} catch (error) {
  out({ error: String(error?.message ?? error) })
}
`

// what the child may read: the slice's own dir, where emit wrote everything it runs, and every node_modules from it
// up, where its schema libraries resolve, through any symlinks into a package store. Not the app root: an escaped
// slice could otherwise read .env files into the published schema (review of bab4b5cf)
/** The child's Node flags: the permission model, reading only the slice's own dir and the node_modules above it. */
export const childArgs = (dir: string) => [
  '--permission',
  ...readable(dir).map((d) => `--allow-fs-read=${d}`),
]
const readable = (root: string) => {
  const dirs = [path.resolve(root)]
  for (let d = path.resolve(root); ; d = path.dirname(d)) {
    const nm = path.join(d, 'node_modules')
    if (existsSync(nm)) dirs.push(nm, realpathSync(nm))
    if (path.dirname(d) === d) break
  }
  return [...new Set(dirs)]
}

/** RFC 0005 §2.1's E3: an action's input schema, by its slice, or why it's opaque. Never throws on author input. */
export const sliceInput = (
  root: string,
  file: string,
  source: string,
  input: Node,
  options: { strict?: boolean; timeoutMs?: number } = {},
): SliceResult => {
  let plan: ReturnType<typeof planSlice>
  try {
    plan = planSlice(file, source, input)
  } catch (error) {
    return { status: 'opaque', reason: `the slice couldn't be read: ${(error as Error).message}` }
  }
  if (plan.status === 'opaque') return plan
  if (options.strict && plan.lossy.length)
    return {
      status: 'opaque',
      reason: `strict mode: the schema uses ${plan.lossy.join(', ')}, which JSON Schema drops`,
    }
  const id = createHash('sha256')
    .update(file)
    .update(String(input.start))
    .digest('hex')
    .slice(0, 16)
  const dir = path.join(root, '.affordances', '.slice', id)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  try {
    const entry = emit(plan, dir)
    const runner = path.join(dir, 'run.mjs')
    writeFileSync(runner, RUNNER)
    // an empty environment: the slice can't read secrets or configuration (RFC 0005 §1)
    // Node's permission model (review of aef81dc1): reads only the app and the node_modules it resolves from, and no
    // writes, network, child processes or workers. The slice rule is a lint, not a sandbox; this is the sandbox
    // two evaluations, each in a fresh child: a slice whose output differs between them read a clock or chance the
    // lint missed (review of bab4b5cf), so it's opaque rather than published
    const run = () =>
      spawnSync(process.execPath, [...childArgs(dir), runner, entry], {
        cwd: dir,
        // next's types make NODE_ENV required; the child gets none, on purpose
        env: {} as NodeJS.ProcessEnv,
        encoding: 'utf8',
        timeout: options.timeoutMs ?? 15_000,
      })
    const child = run()
    if (child.error)
      return { status: 'opaque', reason: `the slice's evaluation failed: ${child.error.message}` }
    let result: { schema?: Record<string, unknown>; error?: string }
    try {
      result = JSON.parse(child.stdout)
    } catch {
      return {
        status: 'opaque',
        reason: `the slice's evaluation failed: ${child.stderr.trim().split('\n')[0] ?? 'no output'}`,
      }
    }
    if (!result.schema)
      return { status: 'opaque', reason: `the slice's evaluation failed: ${result.error}` }
    if (run().stdout !== child.stdout)
      return { status: 'opaque', reason: 'two evaluations of the slice gave different schemas' }
    return { status: 'converted', schema: result.schema, lossy: plan.lossy }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Each `defineAction({ input })` in an actions file: its export and its input expression, for E3. */
export const findInputs = (file: string, source: string): { local: string; input: Node }[] => {
  const { program } = parseSync(file, source)
  const found: { local: string; input: Node }[] = []
  for (const node of program.body as unknown as Node[]) {
    if (node.type !== 'ExportNamedDeclaration') continue
    const declaration = node.declaration as Node | null
    if (declaration?.type !== 'VariableDeclaration') continue
    for (const d of declaration.declarations as Node[]) {
      const init = d.init as Node | null
      if (init?.type !== 'CallExpression') continue
      const callee = init.callee as Node
      const name =
        callee.type === 'Identifier' ? callee.name : (callee.property as Node | undefined)?.name
      if (name !== 'defineAction') continue
      const config = (init.arguments as Node[])[0]
      if (config?.type !== 'ObjectExpression') continue
      const prop = (config.properties as Node[]).find(
        (p) => p.type === 'Property' && !p.computed && (p.key as Node).name === 'input',
      )
      if (prop) found.push({ local: (d.id as Node).name as string, input: prop.value as Node })
    }
  }
  return found
}

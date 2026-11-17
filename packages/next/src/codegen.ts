import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseSync } from 'oxc-parser'

export type RouteEntry = {
  route: string
  // paths relative to the project root, without extension
  state?: string
  actions?: { file: string; exports: ActionExport[] }
}

// an action as codegen reads it from source: its export, its route-local name, and its capability id when it has
// one (RFC 0001 §10.1's migration form)
export type ActionExport = { local: string; name: string; id?: string }

// RFC 0001 §6.1's identifier
const ID = /^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)*$/

export class CodegenError extends Error {
  override name = 'AffordancesCodegenError'
}

const sources = ['.ts', '.tsx', '.js', '.jsx']

export const findAppDir = (root: string) => {
  for (const dir of ['app', 'src/app'])
    if (existsSync(path.join(root, dir))) return path.join(root, dir)
  throw new CodegenError(`No app directory in ${root}`)
}

// app/(shop)/products/[slug] → /products/[slug]; groups and parallel slots don't show in the url
const toRoute = (segments: string[]) =>
  `/${segments.filter((s) => !/^\(.*\)$/.test(s) && !s.startsWith('@')).join('/')}`

const findFile = (dir: string, base: string) =>
  sources.map((ext) => path.join(dir, base + ext)).find((file) => existsSync(file))

type Node = { type: string; [key: string]: unknown }

// export const x = defineAction({ name: 'x', … }): the action's name has to be a literal so the manifest is static
const parseActions = (file: string, source: string) => {
  const { program, errors } = parseSync(file, source)
  if (errors.length) throw new CodegenError(`${file}: ${errors[0]!.message}`)
  const body = program.body as unknown as Node[]
  if (!body.some((node) => node.type === 'ExpressionStatement' && node.directive === 'use server'))
    throw new CodegenError(`${file}: actions files must start with 'use server'`)

  const found: ActionExport[] = []
  for (const node of body) {
    if (node.type !== 'ExportNamedDeclaration') continue
    const declaration = node.declaration as Node | null
    if (declaration?.type !== 'VariableDeclaration') continue
    for (const declarator of declaration.declarations as Node[]) {
      const init = declarator.init as Node | null
      if (init?.type !== 'CallExpression') continue
      const callee = init.callee as Node
      const callName = callee.type === 'Identifier' ? callee.name : (callee.property as Node)?.name
      if (callName !== 'defineAction') continue
      const local = (declarator.id as Node).name as string
      const config = (init.arguments as Node[])[0]
      const prop = (key: string) =>
        config?.type === 'ObjectExpression'
          ? (config.properties as Node[]).find(
              (p) => p.type === 'Property' && (p.key as Node).name === key,
            )
          : undefined
      const value = prop('name')?.value as Node | undefined
      if (value?.type !== 'Literal' || typeof value.value !== 'string')
        throw new CodegenError(`${file}: ${local} needs a string literal \`name\``)
      // an id is optional, and read like the name: a literal, so the build never imports the app
      const idProp = prop('id')
      const idValue = idProp?.value as Node | undefined
      if (idProp && (idValue?.type !== 'Literal' || typeof idValue.value !== 'string'))
        throw new CodegenError(`${file}: ${local}'s \`id\` must be a string literal`)
      const id = idValue?.value as string | undefined
      if (id !== undefined && (!ID.test(id) || id.length > 128))
        throw new CodegenError(
          `${file}: ${local}'s id ${JSON.stringify(id)} isn't an identifier: dotted lowercase-first segments, like 'commerce.cart.addItem'`,
        )
      found.push({ local, name: value.value, ...(id !== undefined && { id }) })
    }
  }
  return found
}

export const scan = (root: string): RouteEntry[] => {
  const appDir = findAppDir(root)
  const entries: RouteEntry[] = []
  const relative = (file: string) => path.relative(root, file).replace(/\.[jt]sx?$/, '')
  const walk = (dir: string, segments: string[]) => {
    const stateFile = findFile(dir, 'state')
    const actionsFile = findFile(dir, 'actions')
    if (stateFile || actionsFile) {
      const entry: RouteEntry = { route: toRoute(segments) }
      if (stateFile) {
        const { program } = parseSync(stateFile, readFileSync(stateFile, 'utf8'))
        if (!program.body.some((node) => node.type === 'ExportDefaultDeclaration'))
          throw new CodegenError(`${stateFile}: state files must \`export default defineState(…)\``)
        entry.state = relative(stateFile)
      }
      if (actionsFile) {
        const exports = parseActions(actionsFile, readFileSync(actionsFile, 'utf8'))
        const seen = new Set<string>()
        for (const { name } of exports) {
          if (seen.has(name))
            throw new CodegenError(
              `${actionsFile}: two actions are named ${name} on ${entry.route}`,
            )
          seen.add(name)
        }
        entry.actions = { file: relative(actionsFile), exports }
      }
      entries.push(entry)
    }
    for (const child of readdirSync(dir, { withFileTypes: true })) {
      // _private folders aren't routes; api/affordances is ours
      if (!child.isDirectory() || child.name.startsWith('_') || child.name === 'node_modules')
        continue
      walk(path.join(dir, child.name), [...segments, child.name])
    }
  }
  walk(appDir, [])
  // an identity is the app's, not a route's: one capability id names one action
  const ids = new Map<string, string>()
  for (const { route, actions } of entries)
    for (const { id, name } of actions?.exports ?? []) {
      if (id === undefined) continue
      const seen = ids.get(id)
      if (seen) throw new CodegenError(`${id} is the id of both ${seen} and ${name} on ${route}`)
      ids.set(id, `${name} on ${route}`)
    }
  return entries.toSorted((a, b) => a.route.localeCompare(b.route))
}

export const render = (entries: RouteEntry[], options: { name?: string } = {}) => {
  const imports: string[] = []
  const routes = entries.map((entry, i) => {
    const parts: string[] = []
    if (entry.state) {
      imports.push(`import state${i} from '../${entry.state}'`)
      parts.push(`state: state${i}`)
    }
    const names = entry.actions?.exports.map((e) => e.local) ?? []
    if (names.length)
      imports.push(`import { ${names.join(', ')} } from '../${entry.actions!.file}'`)
    parts.push(`actions: [${names.join(', ')}]`)
    return `    ${JSON.stringify(entry.route)}: { ${parts.join(', ')} },`
  })
  return `// generated by @affordances/next from app/**/{actions,state}.ts; don't edit
import type { Manifest } from '@affordances/next'
${imports.join('\n')}

export const manifest = {${options.name ? `\n  name: ${JSON.stringify(options.name)},` : ''}
  routes: {
${routes.join('\n')}
  },
} satisfies Manifest
`
}

// writes .affordances/manifest.ts only when it changed, so watchers don't loop
export const generate = (root: string, options: { name?: string } = {}) => {
  const entries = scan(root)
  const out = path.join(root, '.affordances', 'manifest.ts')
  const code = render(entries, options)
  mkdirSync(path.dirname(out), { recursive: true })
  if (!existsSync(out) || readFileSync(out, 'utf8') !== code) writeFileSync(out, code)
  return entries
}

// RFC 0001 §10.1: a v0 action without a capability id gets a suggestion, never an identity. Only an id written in
// source reaches a manifest; writeIds is the codemod that writes the suggestions, for the developer to review
export type MissingId = {
  code: 'W_NO_ID'
  route: string
  file: string
  local: string
  name: string
  suggested: string
}

// one identifier segment from free text: camelCase, starting with a lowercase letter
const segment = (text: string) => {
  const words = text.split(/[^A-Za-z0-9]+/).filter(Boolean)
  const joined = words.map((w, i) => (i ? w[0]!.toUpperCase() + w.slice(1) : w)).join('')
  const lower = joined.charAt(0).toLowerCase() + joined.slice(1)
  return /^[a-z]/.test(lower) ? lower : `r${lower}`
}
const parts = (route: string, withParams: boolean) =>
  route
    .split('/')
    .filter(Boolean)
    .flatMap((s) => {
      const param = s.match(/^\[{1,2}(?:\.\.\.)?([^\]]+)\]{1,2}$/)
      return param ? (withParams ? [segment(param[1]!)] : []) : [segment(s)]
    })

// the route's static segments and the action's name: /products/[slug] and addToCart give products.addToCart
export const suggestId = (route: string, name: string, withParams = false) =>
  [...parts(route, withParams), segment(name)].join('.')

export const missingIds = (entries: RouteEntry[]): MissingId[] => {
  const taken = new Set(
    entries.flatMap((e) => e.actions?.exports.flatMap((x) => (x.id ? [x.id] : [])) ?? []),
  )
  const out: MissingId[] = []
  for (const { route, actions } of entries)
    for (const x of actions?.exports ?? []) {
      if (x.id) continue
      // two routes with the same static segments: name the params too, then number what's left
      let suggested = suggestId(route, x.name)
      if (taken.has(suggested)) suggested = suggestId(route, x.name, true)
      for (let n = 2; taken.has(suggested); n++) suggested = `${suggestId(route, x.name, true)}${n}`
      taken.add(suggested)
      out.push({
        code: 'W_NO_ID',
        route,
        file: actions!.file,
        local: x.local,
        name: x.name,
        suggested,
      })
    }
  return out
}

// writes each suggestion into its defineAction, as `id: '…',` after the name, in the file's own indentation
export const writeIds = (root: string): MissingId[] => {
  const missing = missingIds(scan(root))
  // Map.groupBy is ES2024; packages target ES2023 and Node 20
  const byFile = new Map<string, MissingId[]>()
  for (const m of missing) byFile.set(m.file, [...(byFile.get(m.file) ?? []), m])
  // every file is rewritten in memory and read back first, so one that wouldn't parse leaves all of them as they were
  const rewritten: [string, string][] = []
  for (const [file, list] of byFile) {
    const abs = findFile(path.join(root, path.dirname(file)), path.basename(file))!
    let source = readFileSync(abs, 'utf8')
    const { program } = parseSync(abs, source)
    const inserts: [number, string][] = []
    for (const node of program.body as unknown as Node[]) {
      const declaration = (node.type === 'ExportNamedDeclaration' && node.declaration) as
        | Node
        | false
      if (!declaration || declaration.type !== 'VariableDeclaration') continue
      for (const declarator of declaration.declarations as Node[]) {
        const want = list.find((m) => m.local === (declarator.id as Node).name)
        const config = ((declarator.init as Node)?.arguments as Node[] | undefined)?.[0]
        const name = (config?.properties as Node[] | undefined)?.find(
          (p) => p.type === 'Property' && (p.key as Node).name === 'name',
        )
        if (!want || !name) continue
        // before the name, so nothing after it (a comment, a missing comma) matters: `id: '…',` and then the name, on
        // the name's own line and indent, or inline when it shares a line
        const start = name.start as number
        const lineStart = source.lastIndexOf('\n', start - 1) + 1
        const indent = source.slice(lineStart, start)
        const text = /^\s*$/.test(indent)
          ? `id: '${want.suggested}',\n${indent}`
          : `id: '${want.suggested}', `
        inserts.push([start, text])
      }
    }
    for (const [at, text] of inserts.toSorted(([a], [b]) => b - a))
      source = source.slice(0, at) + text + source.slice(at)
    // never write a file the parser can't read back
    const { errors } = parseSync(abs, source)
    if (errors.length)
      throw new CodegenError(
        `${file}: adding ids would break it (${errors[0]!.message}), so no file was changed`,
      )
    rewritten.push([abs, source])
  }
  for (const [abs, source] of rewritten) writeFileSync(abs, source)
  return missing
}

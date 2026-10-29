import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseSync } from 'oxc-parser'

export type RouteEntry = {
  route: string
  // paths relative to the project root, without extension
  state?: string
  actions?: { file: string; exports: { local: string; name: string }[] }
}

export class CodegenError extends Error {
  override name = 'AffordCodegenError'
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

  const found: { local: string; name: string }[] = []
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
      const nameProp =
        config?.type === 'ObjectExpression'
          ? (config.properties as Node[]).find(
              (p) => p.type === 'Property' && (p.key as Node).name === 'name',
            )
          : undefined
      const value = nameProp?.value as Node | undefined
      if (value?.type !== 'Literal' || typeof value.value !== 'string')
        throw new CodegenError(`${file}: ${local} needs a string literal \`name\``)
      found.push({ local, name: value.value })
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
      // _private folders aren't routes; api/afford is ours
      if (!child.isDirectory() || child.name.startsWith('_') || child.name === 'node_modules')
        continue
      walk(path.join(dir, child.name), [...segments, child.name])
    }
  }
  walk(appDir, [])
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
  return `// generated by @afford/next from app/**/{actions,state}.ts; don't edit
import type { Manifest } from '@afford/next'
${imports.join('\n')}

export const manifest = {${options.name ? `\n  name: ${JSON.stringify(options.name)},` : ''}
  routes: {
${routes.join('\n')}
  },
} satisfies Manifest
`
}

// writes .afford/manifest.ts only when it changed, so watchers don't loop
export const generate = (root: string, options: { name?: string } = {}) => {
  const entries = scan(root)
  const out = path.join(root, '.afford', 'manifest.ts')
  const code = render(entries, options)
  mkdirSync(path.dirname(out), { recursive: true })
  if (!existsSync(out) || readFileSync(out, 'utf8') !== code) writeFileSync(out, code)
  return entries
}

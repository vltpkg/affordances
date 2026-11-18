import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { parseSync } from 'oxc-parser'
import { byCodeUnit, scan, suggestId } from './codegen.ts'
import type { Diagnostic } from './diagnostics.ts'
import { sliceInput } from './slice.ts'

// RFC 0005 §2.1's extraction: each rule reads one literal from a v0 defineAction, statically, and records its basis.
// A v0 field is `imported` (the developer's v0 declaration, carried across formats), with the file and line as its
// evidence; what the compiler derives is `inferred`. Nothing here is ever `declared`, and nothing is guessed: a value
// that isn't a literal is read as absent. A capability-bound action extracts nothing but its binding (E1). The
// output is IR-shaped definitions for M6c's pipeline, which composes them with the capability modules and validates

export { SOURCE } from './source.ts'
import { SOURCE } from './source.ts'

type Provenance = {
  source: string
  basis: 'imported' | 'inferred'
  evidence?: { description: string }[]
}

/** @experimental A capability definition as extraction produces it (RFC 0001 §2's shape, before validation). */
export type ExtractedCapability = {
  id: string
  kind: 'query' | 'action'
  description?: string
  target?: string
  targetAt?: string
  input?: Record<string, unknown>
  authorization?: { principal: 'any' | 'authenticated' }
  confirmation?: { summary: string }
  preconditions?: { id: string; description: string; guard: true }[]
  provenance: Provenance
  fieldProvenance: Record<string, Provenance>
}

/** @experimental What M6c needs to call an extracted capability: its export, its binding and its params (RFC 0005 §4). */
export type ExtractedBinding = {
  capability: string
  protocol: 'affordances/v0'
  address: { route: string; action: string }
  export: { file: string; local: string }
  params: Record<string, { from: 'target' }>
  guards: Record<string, { file: string; local: string }>
}

/** @experimental A defineAction({ capability }): only its binding, checked against the capability in M6c. */
export type BoundAction = {
  route: string
  action: string
  export: { file: string; local: string }
  // the capability it's bound to: the local name it's written with, the module it's imported from, and the name that
  // module exports it as (a rename, or a namespace import's member)
  capability: { local: string; from?: string; imported?: string }
  // the v0 fields it also sets: M6c reports E_BOUND_REDEFINES for any its capability defines
  alsoSets: string[]
}

/** @experimental E9's resource types, inferred from route segments. */
export type ExtractedResource = {
  id: string
  key: string
  description: string
  provenance: Provenance
}

export type Extracted = {
  source: typeof SOURCE
  capabilities: ExtractedCapability[]
  bindings: ExtractedBinding[]
  resources: ExtractedResource[]
  bound: BoundAction[]
  diagnostics: Diagnostic[]
}

type Node = { type: string; start: number; end: number; [key: string]: unknown }

// RFC 0001 §6.1's identifier, as codegen checks it
const ID = /^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)*$/
const V0_FIELDS = [
  'description',
  'input',
  'expose',
  'requires',
  'guard',
  'summary',
  'effects',
  'readOnly',
  'output',
  'jsonSchema',
]

const literal = (node: Node | undefined): unknown =>
  node?.type === 'Literal'
    ? node.value
    : node?.type === 'TemplateLiteral' && (node.expressions as Node[]).length === 0
      ? ((node.quasis as Node[])[0]!.value as { cooked: string }).cooked
      : undefined

// each exported defineAction in an actions file, with its config's properties by name
const actionsIn = (file: string, source: string) => {
  const { program } = parseSync(file, source)
  // each import's local name: its module, and the name the module exports it as ('*' for a namespace import)
  const imports = new Map<string, { from: string; imported: string }>()
  const found: { local: string; props: Map<string, Node>; at: number }[] = []
  for (const node of program.body as unknown as Node[]) {
    if (node.type === 'ImportDeclaration')
      for (const s of node.specifiers as Node[])
        imports.set((s.local as Node).name as string, {
          from: (node.source as Node).value as string,
          imported:
            s.type === 'ImportNamespaceSpecifier'
              ? '*'
              : s.type === 'ImportDefaultSpecifier'
                ? 'default'
                : (((s.imported as Node).name ?? (s.imported as Node).value) as string),
        })
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
      const props = new Map<string, Node>()
      for (const p of config.properties as Node[])
        // spreads are ignored, as codegen ignores them: a spread value isn't a literal (RFC 0005 §2.1)
        if (p.type === 'Property' && !p.computed)
          props.set(((p.key as Node).name ?? (p.key as Node).value) as string, p.value as Node)
      found.push({ local: (d.id as Node).name as string, props, at: d.start })
    }
  }
  return { found, imports }
}

const lineOf = (source: string, offset: number) => source.slice(0, offset).split('\n').length

// E9: the last dynamic segment under a static one, as the target's type and key. The id is the segment as written,
// never singularized (RFC 0005 §9.1); a segment that isn't an identifier, or a catch-all, yields nothing
export const segmentResource = (route: string): { id: string; key: string } | undefined => {
  const parts = route.split('/').filter(Boolean)
  for (let i = parts.length - 1; i > 0; i--) {
    const m = /^\[([A-Za-z_$][\w$]*)\]$/.exec(parts[i]!)
    if (!m) continue
    const id = parts[i - 1]!
    if (id.startsWith('[') || !ID.test(id)) return undefined
    return { id, key: m[1]! }
  }
  return undefined
}

const byId = <T extends { id: string }>(xs: T[]) => xs.toSorted((a, b) => byCodeUnit(a.id, b.id))

/**
 * @experimental RFC 0005 §2.1's rules E1 to E9 over a v0 app, for M6c's pipeline. Throws only codegen's own errors
 * from its scan, which v0's build already fails on; everything it reads itself is a result or a diagnostic.
 */
export const extract = (root: string, options: { strict?: boolean } = {}): Extracted => {
  const capabilities: ExtractedCapability[] = []
  const bindings: ExtractedBinding[] = []
  const resources = new Map<string, ExtractedResource>()
  const bound: BoundAction[] = []
  const diagnostics: Diagnostic[] = []
  const entries = scan(root)

  // E9's conflicts first: a resource type two routes infer with different keys is used by neither (review of
  // 8d2b22e1), so /products/[slug] and /products/[id] never bind one key to the other's
  const keys = new Map<string, Set<string>>()
  for (const { route, actions } of entries) {
    const s = actions && segmentResource(route)
    if (s) keys.set(s.id, (keys.get(s.id) ?? new Set()).add(s.key))
  }
  const conflicted = new Set([...keys].filter(([, k]) => k.size > 1).map(([id]) => id))
  for (const id of conflicted)
    diagnostics.push({
      code: 'W_SEGMENT_CONFLICT',
      file: 'app',
      subject: id,
      detail: entries
        .filter((e) => e.actions && segmentResource(e.route)?.id === id)
        .map((e) => e.route)
        .join(', '),
    })

  for (const entry of entries) {
    if (!entry.actions) continue
    const rel = entry.actions.file
    const file = ['.ts', '.tsx', '.js', '.jsx']
      .map((ext) => path.join(root, rel + ext))
      .find((f) => existsSync(f))!
    const relFile = path.relative(root, file)
    const source = readFileSync(file, 'utf8')
    const { found, imports } = actionsIn(file, source)
    for (const { local, props, at } of found) {
      const line = lineOf(source, at)
      const nameValue = literal(props.get('name'))
      if (typeof nameValue !== 'string') {
        diagnostics.push({
          code: 'W_NOT_LITERAL',
          file: relFile,
          line,
          subject: local,
          detail: 'name',
        })
        continue
      }
      const name = nameValue
      const evidence = [{ description: `defineAction ${local} in ${relFile}:${line}` }]
      const imported: Provenance = { source: SOURCE.id, basis: 'imported', evidence }
      const inferred: Provenance = { source: SOURCE.id, basis: 'inferred' }
      const where = { file: relFile, line, subject: local }
      // a field a rule reads that's present but isn't a literal: read as absent, and said so
      for (const field of ['expose', 'description', 'readOnly', 'requires'])
        if (props.has(field) && literal(props.get(field)) === undefined)
          diagnostics.push({ code: 'W_NOT_LITERAL', ...where, detail: field })

      // a bound action: its binding, and nothing from v0 (RFC 0005 §2.1)
      const cap = props.get('capability')
      if (cap) {
        // the capability as written: an imported name, possibly renamed, or a namespace import's member (caps.cancel)
        const member =
          cap.type === 'MemberExpression' &&
          !cap.computed &&
          (cap.object as Node).type === 'Identifier'
            ? {
                object: (cap.object as Node).name as string,
                property: (cap.property as Node).name as string,
              }
            : undefined
        const capLocal =
          cap.type === 'Identifier'
            ? (cap.name as string)
            : member && imports.get(member.object)?.imported === '*'
              ? `${member.object}.${member.property}`
              : undefined
        const imp = capLocal ? imports.get(member?.object ?? capLocal) : undefined
        bound.push({
          route: entry.route,
          action: name,
          export: { file: relFile, local },
          capability: {
            local: capLocal ?? '',
            ...(imp && {
              from: imp.from,
              imported: imp.imported === '*' ? member!.property : imp.imported,
            }),
          },
          alsoSets: V0_FIELDS.filter((f) => props.has(f)),
        })
        continue
      }

      // E2: the id, a literal, or a suggestion and no capability
      const id = literal(props.get('id'))
      if (typeof id !== 'string') {
        diagnostics.push({
          code: 'W_NO_ID',
          ...where,
          detail: `id: '${suggestId(entry.route, name)}'`,
        })
        continue
      }
      const fieldProvenance: Record<string, Provenance> = { '/id': imported }

      // E4: kind
      const readOnly = literal(props.get('readOnly')) === true
      fieldProvenance['/kind'] = imported

      // E8: description
      const description = literal(props.get('description'))
      if (typeof description === 'string') fieldProvenance['/description'] = imported

      // E5 and E6: authorization and confirmation, from expose's literal
      const expose = literal(props.get('expose'))
      const authorization =
        expose === 'public'
          ? { principal: 'any' as const }
          : expose === 'session' || expose === 'confirm'
            ? { principal: 'authenticated' as const }
            : undefined
      if (authorization) fieldProvenance['/authorization'] = imported
      const confirmation = expose === 'confirm' ? { summary: `Run ${name}` } : undefined
      if (confirmation) {
        fieldProvenance['/confirmation'] = imported
        fieldProvenance['/confirmation/summary'] = inferred
        diagnostics.push({ code: 'W_SUMMARY_GENERIC', ...where })
      }

      // E7: the guard, as one opaque condition described by requires
      const requires = literal(props.get('requires'))
      const preconditions = props.has('guard')
        ? [
            {
              id: 'guard',
              description: typeof requires === 'string' ? requires : `${name}'s guard allows it`,
              guard: true as const,
            },
          ]
        : undefined
      if (preconditions) {
        fieldProvenance['/preconditions'] = imported
        diagnostics.push({ code: 'W_OPAQUE', ...where, subject: `${local}'s guard` })
      }

      // E3: the input, by its slice
      let input: Record<string, unknown> | undefined
      const inputNode = props.get('input')
      if (inputNode) {
        const r = sliceInput(root, file, source, inputNode as never, { strict: options.strict })
        if (r.status === 'converted') {
          input = r.schema
          fieldProvenance['/input'] = inferred
          if (r.lossy.length)
            diagnostics.push({ code: 'W_INPUT_LOSSY', ...where, detail: r.lossy.join(', ') })
        } else diagnostics.push({ code: 'W_INPUT_OPAQUE', ...where, detail: r.reason })
      }

      // E9: the target, from the route's segments
      const inferredSegment = segmentResource(entry.route)
      const segment =
        inferredSegment && !conflicted.has(inferredSegment.id) ? inferredSegment : undefined
      let targetAt: string | undefined
      if (segment) {
        if (!resources.has(segment.id)) {
          resources.set(segment.id, {
            id: segment.id,
            key: segment.key,
            description: `A ${segment.id} resource, from the route segment ${entry.route}`,
            provenance: inferred,
          })
          diagnostics.push({ code: 'W_ATTRIBUTES_UNKNOWN', file: relFile, subject: segment.id })
        }
        fieldProvenance['/target'] = inferred
        if (
          (input?.properties as Record<string, unknown> | undefined)?.[segment.key] !== undefined
        ) {
          targetAt = `/${segment.key}`
          fieldProvenance['/targetAt'] = inferred
        }
      }

      // the effects are never extracted: v0's effects are delta keys, not consequences (RFC 0005 §2.2)
      if (!readOnly) diagnostics.push({ code: 'W_EFFECTS_UNKNOWN', ...where })

      capabilities.push({
        id,
        kind: readOnly ? 'query' : 'action',
        ...(typeof description === 'string' && { description }),
        ...(segment && { target: segment.id }),
        ...(targetAt && { targetAt }),
        ...(input && { input }),
        ...(authorization && { authorization }),
        ...(confirmation && { confirmation }),
        ...(preconditions && { preconditions }),
        provenance: inferred,
        fieldProvenance,
      })
      // E1: the binding, and how to call it (RFC 0005 §4)
      bindings.push({
        capability: id,
        protocol: 'affordances/v0',
        address: { route: entry.route, action: name },
        export: { file: relFile, local },
        params: segment ? { [segment.key]: { from: 'target' } } : {},
        guards: preconditions ? { guard: { file: relFile, local } } : {},
      })
    }
  }

  return {
    source: SOURCE,
    capabilities: byId(capabilities),
    bindings: bindings.toSorted((a, b) => byCodeUnit(a.capability, b.capability)),
    resources: byId([...resources.values()]),
    bound: bound.toSorted((a, b) => byCodeUnit(`${a.route} ${a.action}`, `${b.route} ${b.action}`)),
    diagnostics,
  }
}

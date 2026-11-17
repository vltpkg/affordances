import type { z } from 'zod'
import {
  CapabilityManifest,
  COMPARISONS,
  type CapabilityDefinition,
  type Condition,
  type Expr,
  type JSONSchema,
  type Operand,
  type Provenance,
  type ValidationIssue,
} from './schema.ts'

// RFC 0001 §7.3: the IR's errors (E_) and warnings (W_), each at a JSON Pointer into the manifest. The schema's
// own issues come first; the cross-reference checks run only on a document that parsed
export type Validation =
  | { ok: true; manifest: CapabilityManifest; issues: ValidationIssue[] }
  | { ok: false; manifest?: CapabilityManifest; issues: ValidationIssue[] }

const pointer = (path: readonly PropertyKey[]) =>
  path.map((key) => `/${String(key).replaceAll('~', '~0').replaceAll('/', '~1')}`).join('')

const fromZod = (issue: z.core.$ZodIssue): ValidationIssue => ({
  code:
    (issue.code === 'custom' && (issue.params as { code?: ValidationIssue['code'] })?.code) ||
    'E_SCHEMA',
  message: issue.message,
  at: pointer(issue.path),
})

// the part of an embedded JSON Schema a path walks: `true` where the schema leaves it open (a $ref, a oneOf, no
// type), so that segment is checked only at run time (§3.1)
type Node = JSONSchema | true | undefined
const OPEN_KEYWORDS = ['$ref', 'anyOf', 'oneOf', 'allOf', 'if']
const isOpen = (s: JSONSchema) =>
  OPEN_KEYWORDS.some((k) => k in s) || (s.type === undefined && s.properties === undefined)
const child = (node: Node, key: string): Node => {
  if (node === true || node === undefined) return node
  const properties = node.properties as Record<string, JSONSchema> | undefined
  if (properties && key in properties) return properties[key]
  if (typeof node.additionalProperties === 'object') return node.additionalProperties as JSONSchema
  return isOpen(node) ? true : undefined
}
const element = (node: Node): Node => {
  if (node === true || node === undefined) return node
  if (typeof node.items === 'object') return node.items as JSONSchema
  return isOpen(node) ? true : undefined
}
type Type = 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array'
const typeOf = (node: Node): Type | undefined => {
  if (node === true || node === undefined || typeof node.type !== 'string') return
  return node.type === 'integer' ? 'number' : (node.type as Type)
}
const literalType = (value: unknown): Type =>
  value === null ? 'null' : Array.isArray(value) ? 'array' : (typeof value as Type)

// what each root names, in one place: a capability's context, or a claim's
type Scope = {
  roots: Map<string, Node>
  // a root this scope doesn't allow, with why: input in an authorization condition, say
  forbidden?: (root: string) => string | undefined
  item?: Node
  depth: number
}

const ENFORCEMENT = [
  'kind',
  'safe',
  'idempotent',
  'authorization',
  'confirmation',
  'effects',
  'preconditions',
]
const ROLE_FOR: Record<Provenance['basis'], string> = {
  declared: 'owner',
  inferred: 'tool',
  imported: 'tool',
  observed: 'tool',
  verified: 'third-party',
}

export const validate = (input: unknown): Validation => {
  const parsed = CapabilityManifest.safeParse(input)
  if (!parsed.success) return { ok: false, issues: parsed.error.issues.map(fromZod) }
  const m = parsed.data
  const issues: ValidationIssue[] = []
  const report = (code: ValidationIssue['code'], at: string, message: string) =>
    issues.push({ code, message, at })

  // identifiers (E_DUPLICATE_ID): resources and capabilities share one space; sources and claims have their own
  const definitions = new Map<string, 'resource' | 'capability'>()
  const unique = (ids: [string, string][], what: string) => {
    const seen = new Set<string>()
    for (const [id, at] of ids)
      if (seen.has(id)) report('E_DUPLICATE_ID', at, `two ${what} are ${id}`)
      else seen.add(id)
  }
  unique(
    [
      ...m.resources.map((r, i): [string, string] => [r.id, `/resources/${i}/id`]),
      ...m.capabilities.map((c, i): [string, string] => [c.id, `/capabilities/${i}/id`]),
    ],
    'definitions',
  )
  for (const r of m.resources) definitions.set(r.id, 'resource')
  for (const c of m.capabilities) definitions.set(c.id, 'capability')
  unique(
    m.sources.map((s, i) => [s.id, `/sources/${i}/id`]),
    'sources',
  )
  unique(
    (m.claims ?? []).map((c, i) => [c.id, `/claims/${i}/id`]),
    'claims',
  )
  const resources = new Map(m.resources.map((r) => [r.id, r]))

  // references (E_UNRESOLVED): each names a definition of the right kind; a Ref into another manifest is left alone
  const local = (ref: string) =>
    ref.includes('#')
      ? ref.startsWith(`${m.namespace}#`)
        ? ref.slice(m.namespace.length + 1)
        : undefined
      : ref
  const resolves = (ref: string, at: string, kind?: 'resource' | 'capability') => {
    const id = local(ref)
    if (id === undefined) return
    const found = definitions.get(id)
    if (!found) report('E_UNRESOLVED', at, `${id} names no definition`)
    else if (kind && found !== kind)
      report('E_UNRESOLVED', at, `${id} is a ${found}, not a ${kind}`)
  }
  m.resources.forEach((r, i) => {
    r.contains?.forEach((id, j) => resolves(id, `/resources/${i}/contains/${j}`, 'resource'))
    // E_KEY: the key is one of the declared attributes
    const properties = r.attributes?.properties as Record<string, unknown> | undefined
    if (properties && !(r.key in properties))
      report('E_KEY', `/resources/${i}/key`, `${r.key} isn't one of ${r.id}'s attributes`)
  })

  // paths (E_PATH, E_TYPE, E_DEPTH), walked with the scope that says what each root is
  const resolvePath = (path: string, scope: Scope, at: string): { ok: boolean; node: Node } => {
    const [root, ...rest] = path.split('.')
    if (root === 'item') {
      if (scope.item === undefined) {
        report('E_PATH', at, 'item is only defined inside a quantifier')
        return { ok: false, node: undefined }
      }
      return walk(scope.item, rest, path, at)
    }
    const why = scope.forbidden?.(root!)
    if (why) {
      report('E_PATH', at, why)
      return { ok: false, node: undefined }
    }
    if (!scope.roots.has(root!)) {
      report('E_PATH', at, `${root} isn't a root here`)
      return { ok: false, node: undefined }
    }
    const node = scope.roots.get(root!)
    if (node === undefined) {
      report('E_PATH', at, `${root} declares no attributes, so ${path} can't be read`)
      return { ok: false, node: undefined }
    }
    return walk(node, rest, path, at)
  }
  const walk = (start: Node, rest: string[], path: string, at: string) => {
    let node = start
    for (const key of rest) {
      node = child(node, key)
      if (node === undefined) {
        report('E_PATH', at, `${path} doesn't name a declared attribute`)
        return { ok: false, node: undefined }
      }
    }
    return { ok: true, node }
  }

  const operand = (
    o: Operand,
    scope: Scope,
    at: string,
    arrayAllowed: boolean,
  ): Type | undefined => {
    if ('value' in o) {
      if (o.value === null)
        report('E_TYPE', `${at}/value`, 'a null literal never compares; use exists')
      else if (Array.isArray(o.value) && !arrayAllowed)
        report('E_TYPE', `${at}/value`, "an array literal is only allowed on in's right side")
      return o.value === null ? undefined : literalType(o.value)
    }
    if ('count' in o) {
      const { ok, node } = resolvePath(o.count, scope, `${at}/count`)
      const type = ok ? typeOf(node) : undefined
      if (type && type !== 'array')
        report('E_TYPE', `${at}/count`, `count needs an array, and ${o.count} is a ${type}`)
      return 'number'
    }
    const { ok, node } = resolvePath(o.path, scope, `${at}/path`)
    return ok ? typeOf(node) : undefined
  }

  const expr = (e: Expr, scope: Scope, at: string): void => {
    if ('all' in e) return e.all.forEach((x, i) => expr(x, scope, `${at}/all/${i}`))
    if ('any' in e) return e.any.forEach((x, i) => expr(x, scope, `${at}/any/${i}`))
    if ('not' in e) return expr(e.not, scope, `${at}/not`)
    if ('exists' in e) return void resolvePath(e.exists, scope, `${at}/exists`)
    if ('some' in e || 'every' in e) {
      const [name, q] = 'some' in e ? ['some', e.some] : ['every', e.every]
      if (scope.depth >= 2)
        report('E_DEPTH', `${at}/${name}`, 'quantifiers nest at most two levels')
      // `of` is resolved in the enclosing scope, `where` in the new one (§3.1)
      const { ok, node } = resolvePath(q.of, scope, `${at}/${name}/of`)
      const type = ok ? typeOf(node) : undefined
      if (type && type !== 'array')
        report('E_TYPE', `${at}/${name}/of`, `${q.of} is a ${type}, not an array`)
      return expr(
        q.where,
        { ...scope, item: ok ? element(node) : true, depth: scope.depth + 1 },
        `${at}/${name}/where`,
      )
    }
    const op = COMPARISONS.find((c) => c in e)!
    const [left, right] = (e as Record<string, [Operand, Operand]>)[op]!
    const a = operand(left, scope, `${at}/${op}/0`, false)
    const b = operand(right, scope, `${at}/${op}/1`, op === 'in')
    if (op === 'in') {
      if (b && b !== 'array')
        report('E_TYPE', `${at}/${op}/1`, `in needs an array on the right, not a ${b}`)
    } else if (a && b) {
      const ordering = op !== 'eq' && op !== 'ne'
      if (ordering && (a !== b || (a !== 'number' && a !== 'string')))
        report(
          'E_TYPE',
          `${at}/${op}`,
          `${op} compares two numbers or two strings, not ${a} and ${b}`,
        )
      else if (!ordering && a !== b)
        report('E_TYPE', `${at}/${op}`, `${op} compares values of one type, not ${a} and ${b}`)
    }
  }
  const conditions = (list: Condition[] | undefined, scope: Scope, at: string) =>
    list?.forEach((c, i) => 'expr' in c && expr(c.expr, scope, `${at}/${i}/expr`))

  const attributesOf = (id: string | undefined): Node =>
    id ? resources.get(id)?.attributes : undefined
  const scopeOf = (c: CapabilityDefinition): Scope => {
    const roots = new Map<string, Node>()
    if (c.target) roots.set('target', attributesOf(c.target))
    roots.set('input', c.input)
    roots.set('principal', m.principal?.attributes)
    for (const r of c.references ?? []) roots.set(r.name, attributesOf(r.resource))
    return { roots, depth: 0 }
  }

  m.capabilities.forEach((c, i) => {
    const at = `/capabilities/${i}`
    if (c.target) resolves(c.target, `${at}/target`, 'resource')
    if (c.deprecated?.replacedBy)
      resolves(c.deprecated.replacedBy, `${at}/deprecated/replacedBy`, 'capability')
    unique(
      (c.references ?? []).map((r, j) => [r.name, `${at}/references/${j}/name`]),
      'references',
    )
    c.references?.forEach((r, j) =>
      resolves(r.resource, `${at}/references/${j}/resource`, 'resource'),
    )
    unique(
      [
        ...(c.preconditions ?? []).map((x, j): [string, string] => [
          x.id,
          `${at}/preconditions/${j}/id`,
        ]),
        ...(c.authorization?.conditions ?? []).map((x, j): [string, string] => [
          x.id,
          `${at}/authorization/conditions/${j}/id`,
        ]),
      ],
      'conditions',
    )

    const scope = scopeOf(c)
    conditions(c.preconditions, scope, `${at}/preconditions`)
    // authorization is decided before the input and references load (§3.2)
    const references = new Set(c.references?.map((r) => r.name))
    conditions(
      c.authorization?.conditions,
      {
        ...scope,
        forbidden: (root) =>
          root === 'input' || references.has(root)
            ? `an authorization condition reads only principal and target, not ${root}`
            : undefined,
      },
      `${at}/authorization/conditions`,
    )

    // the summary's {path} placeholders: target, input or a reference, never the principal (§3.2)
    if (c.confirmation) {
      const summary = c.confirmation.summary.replaceAll('{{', '').replaceAll('}}', '')
      for (const [, path] of summary.matchAll(/\{([^{}]*)\}/g))
        if (path!.startsWith('principal.'))
          report('E_PATH', `${at}/confirmation/summary`, `a summary can't show ${path}`)
        else resolvePath(path!, scope, `${at}/confirmation/summary`)
    }

    c.effects?.forEach((e, j) => {
      const eat = `${at}/effects/${j}`
      if (e.compensatedBy) resolves(e.compensatedBy, `${eat}/compensatedBy`, 'capability')
      if (e.category !== 'state') return
      resolves(e.resource, `${eat}/resource`, 'resource')
      if (!e.establishes) return
      // establishes reads the target, and only for an effect on the capability's own target (§3.1)
      if (e.resource !== c.target)
        report(
          'E_PATH',
          `${eat}/establishes`,
          `establishes needs the effect to be on ${c.id}'s target`,
        )
      else
        expr(
          e.establishes,
          {
            roots: new Map([['target', attributesOf(c.target)]]),
            forbidden: (root) =>
              root === 'target' ? undefined : `establishes reads only target, not ${root}`,
            depth: 0,
          },
          `${eat}/establishes`,
        )
    })

    // warnings
    if (c.preconditions?.length && c.preconditions.every((x) => 'guard' in x))
      report('W_OPAQUE', `${at}/preconditions`, `every precondition of ${c.id} is a guard`)
    if (c.kind === 'action' && c.effects === undefined)
      report('W_EFFECTS_UNKNOWN', `${at}/effects`, `${c.id}'s effects are unknown`)
  })

  m.relations?.forEach((r, i) => {
    resolves(r.from, `/relations/${i}/from`)
    resolves(r.to, `/relations/${i}/to`)
  })
  m.bindings?.forEach((b, i) => resolves(b.capability, `/bindings/${i}/capability`, 'capability'))

  m.claims?.forEach((c, i) => {
    const at = `/claims/${i}`
    resolves(c.subject, `${at}/subject`)
    // E_ENFORCEMENT_CLAIM: a claim can't be about a field enforcement reads (rule 2)
    const field = c.about?.split('/')[1]
    if (field && ENFORCEMENT.includes(field))
      report(
        'E_ENFORCEMENT_CLAIM',
        `${at}/about`,
        `a claim can't be about ${field}, which enforcement reads`,
      )
    // applies reads only the target: the subject resource, or the subject capability's target (§9)
    if (c.applies) {
      const id = local(c.subject)
      const subject = id === undefined ? undefined : definitions.get(id)
      const target = subject === 'resource' ? id : m.capabilities.find((x) => x.id === id)?.target
      expr(
        c.applies,
        {
          roots: new Map(target ? [['target', attributesOf(target)]] : []),
          forbidden: (root) =>
            root === 'target' ? undefined : `applies reads only target, not ${root}`,
          depth: 0,
        },
        `${at}/applies`,
      )
    }
  })

  // provenance (E_SOURCE, E_BASIS): every record names a declared source whose role fits its basis (rule 3)
  const sources = new Map(m.sources.map((s) => [s.id, s]))
  const provenance = (p: Provenance | undefined, at: string) => {
    if (!p) return
    const source = sources.get(p.source)
    if (!source) return report('E_SOURCE', `${at}/source`, `${p.source} isn't a declared source`)
    if (source.role !== ROLE_FOR[p.basis])
      report(
        'E_BASIS',
        `${at}/basis`,
        `${p.basis} needs a ${ROLE_FOR[p.basis]} source, and ${source.id} is ${source.role}`,
      )
  }
  const attributed = (
    x: { provenance?: Provenance; fieldProvenance?: Record<string, Provenance> },
    at: string,
  ) => {
    provenance(x.provenance, at + '/provenance')
    for (const [key, p] of Object.entries(x.fieldProvenance ?? {}))
      provenance(p, `${at}/fieldProvenance${pointer([key])}`)
  }
  provenance(m.provenance, '/provenance')
  if (m.principal) attributed(m.principal, '/principal')
  m.resources.forEach((r, i) => attributed(r, `/resources/${i}`))
  m.capabilities.forEach((c, i) => attributed(c, `/capabilities/${i}`))
  m.relations?.forEach((r, i) => provenance(r.provenance, `/relations/${i}/provenance`))
  m.claims?.forEach((c, i) => provenance(c.provenance, `/claims/${i}/provenance`))

  const ok = !issues.some((issue) => issue.code.startsWith('E_'))
  return ok ? { ok: true, manifest: m, issues } : { ok: false, manifest: m, issues }
}

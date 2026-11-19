import { canonicalJson, compare } from './canonical.ts'
import { normalize } from './normalize.ts'
import type { CapabilityManifest, Provenance, ValidationIssue } from './schema.ts'

// RFC 0001 §6.4: fragments of one namespace, united. Equal things collapse; two different things with one identity
// are E_CONFLICT, never an override. The result is normalized, so the order fragments come in can't change it:
// compose is commutative, associative and idempotent
export type Composition =
  | { ok: true; manifest: CapabilityManifest; issues: [] }
  | { ok: false; issues: ValidationIssue[] }

type Item = { provenance?: Provenance }

// a definition's provenance, made explicit, so fragments with different defaults still compare what they say
const explicit = <T extends Item>(item: T, base: Provenance): T => ({
  ...item,
  provenance: item.provenance ?? base,
})

export const compose = (fragments: CapabilityManifest[]): Composition => {
  if (!fragments.length) throw new TypeError('compose needs at least one fragment')
  const issues: ValidationIssue[] = []
  const conflict = (at: string, message: string) => issues.push({ code: 'E_CONFLICT', message, at })

  const [first] = fragments
  for (const f of fragments) {
    if (f.namespace !== first!.namespace)
      conflict('/namespace', `${f.namespace} isn't ${first!.namespace}`)
    if (f.schemaVersion !== first!.schemaVersion)
      conflict('/schemaVersion', 'fragments of two IR versions')
  }

  // one thing per identity; equal in canonical form, or E_CONFLICT
  const unite = <T>(field: string, all: T[], id: (x: T) => string) => {
    const byId = new Map<string, T>()
    for (const x of all) {
      const seen = byId.get(id(x))
      if (!seen) byId.set(id(x), x)
      else if (canonicalJson(seen) !== canonicalJson(x))
        conflict(`/${field}`, `two different ${field} are ${id(x)}`)
    }
    return [...byId.values()]
  }
  // one optional value: absent takes the others', two different ones conflict
  const single = <T>(field: string, values: (T | undefined)[]) => {
    const given = values.filter((v) => v !== undefined)
    if (new Set(given.map(canonicalJson)).size > 1)
      conflict(`/${field}`, `fragments declare different ${field}`)
    return given[0]
  }

  // normalized one by one first, so equal definitions written differently compare equal
  const parts = fragments.map(normalize)
  const definitions = <K extends 'resources' | 'capabilities'>(key: K) =>
    unite(
      key,
      parts.flatMap((f) => (f[key] as Item[]).map((d) => explicit(d, f.provenance))),
      (d) => (d as { id: string }).id,
    ) as CapabilityManifest[K]

  const resources = definitions('resources')
  const capabilities = definitions('capabilities')
  const sources = unite(
    'sources',
    parts.flatMap((f) => f.sources),
    (s) => s.id,
  )
  const claims = unite(
    'claims',
    parts.flatMap((f) => f.claims ?? []),
    (c) => c.id,
  )
  // relations and bindings have no identity of their own: united, and exact duplicates collapse in normalize
  const relations = parts.flatMap((f) => (f.relations ?? []).map((r) => explicit(r, f.provenance)))
  const bindings = parts.flatMap((f) => f.bindings ?? [])
  // the principal keeps its fragment's attribution, as definitions do (rule 3)
  const principal = single(
    'principal',
    parts.map((f) => f.principal && explicit(f.principal, f.provenance)),
  )
  const title = single(
    'title',
    parts.map((f) => f.title),
  )

  const extensions: Record<string, unknown> = {}
  for (const f of parts)
    for (const [key, value] of Object.entries(f.extensions ?? {})) {
      if (key in extensions && canonicalJson(extensions[key]) !== canonicalJson(value))
        conflict(`/extensions`, `fragments give ${key} different values`)
      extensions[key] ??= value
    }

  if (issues.length) return { ok: false, issues }

  // the default: the fragments' one, when they agree; otherwise the least in canonical order, which every
  // definition now overrides where it differs, so the choice doesn't change what's said
  const defaults = [...new Set(parts.map((f) => canonicalJson(f.provenance)))].toSorted(compare)
  const manifest = normalize({
    schemaVersion: first!.schemaVersion,
    namespace: first!.namespace,
    ...(title !== undefined && { title }),
    provenance: JSON.parse(defaults[0]!) as Provenance,
    ...(principal && { principal }),
    sources,
    resources,
    capabilities,
    relations,
    claims,
    bindings,
    ...(Object.keys(extensions).length && { extensions }),
  })
  return { ok: true, manifest, issues: [] }
}

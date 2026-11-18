import { byCodeUnit } from './order.ts'
import { SOURCE } from './source.ts'

// RFC 0005 §4's merge: what extraction recovers from the v0 actions, into the manifest the capability modules make. A
// module's definition is the app's own, so it wins over an extracted one, and the two never silently merge. Pure, with
// no file system and no ir: it runs in the evaluator's child, between fromModules and ir's normalize and validate, so
// the build's own process never loads ir

type Diagnostic = { code: string; file: string; line?: number; subject?: string; detail?: string }
type Definition = { id: string; [k: string]: unknown }

/** @experimental The manifest as fromModules makes it, before the merge. */
export type ModuleManifest = {
  capabilities: Definition[]
  resources?: Definition[]
  sources?: { id: string; [k: string]: unknown }[]
  bindings?: { capability: string; protocol: string; address: Record<string, string> }[]
  [k: string]: unknown
}

/** @experimental One binding as bindings.ts holds it: the action that implements a capability, and how to call it. */
export type CompiledBinding = {
  capability: string
  address: { route: string; action: string }
  export: { file: string; local: string }
  params: Record<string, { from: 'target' }>
  guards: Record<string, { file: string; local: string }>
}

/** @experimental What the parent hands the child to merge: extraction's output, with bound actions already resolved. */
export type Extraction = {
  capabilities: Definition[]
  resources: Definition[]
  bindings: (CompiledBinding & { protocol: string })[]
  bound: {
    route: string
    action: string
    export: { file: string; local: string }
    // the capability module export it imports, resolved by the parent; undefined when it isn't one
    target?: { file: string; name: string }
    describe: string
    alsoSets: string[]
  }[]
  diagnostics: Diagnostic[]
}

// a bound action's v0 field, and the capability field it would redefine (E_BOUND_REDEFINES). Not effects: v0's are
// delta keys, the state the v0 response diffs, not consequences (RFC 0005 §2.2), so a bound action keeps them
const REDEFINES: Record<string, string[]> = {
  description: ['description'],
  input: ['input'],
  output: ['output'],
  expose: ['authorization', 'confirmation'],
  requires: ['preconditions'],
  guard: ['preconditions'],
  readOnly: ['kind'],
  summary: ['confirmation'],
}

/** @experimental Merge extraction into the modules' manifest (RFC 0005 §4). */
export const merge = (
  manifest: ModuleManifest,
  exported: { file: string; name: string; brand: string; id: string }[],
  extracted: Extraction,
): { manifest: ModuleManifest; bindings: CompiledBinding[]; diagnostics: Diagnostic[] } => {
  const diagnostics: Diagnostic[] = []
  const capabilities = new Map(manifest.capabilities.map((c) => [c.id, c]))
  const resources = new Set((manifest.resources ?? []).map((r) => r.id))
  diagnostics.push(
    ...extracted.diagnostics.filter(
      // a resource a module declares has its attributes: E9's warning doesn't apply
      (d) => !(d.code === 'W_ATTRIBUTES_UNKNOWN' && d.subject && resources.has(d.subject)),
    ),
  )
  let usesSource = false
  for (const r of extracted.resources)
    if (!resources.has(r.id)) {
      ;(manifest.resources ??= []).push(r)
      usesSource = true
    }
  const bindings: CompiledBinding[] = []
  for (const c of extracted.capabilities) {
    const b = extracted.bindings.find((x) => x.capability === c.id)!
    if (capabilities.has(c.id)) {
      diagnostics.push({
        code: 'E_CAPABILITY_DUPLICATE',
        file: b.export.file,
        subject: c.id,
        detail: `${b.export.local} has the id of a capability a module defines: bind it with defineAction({ capability }) instead`,
      })
      continue
    }
    manifest.capabilities.push(c)
    usesSource = true
    const { protocol: _, ...binding } = b
    bindings.push(binding)
  }

  // each bound action: its capability, by the module export it imports, and nothing it redefines
  for (const a of extracted.bound) {
    const target = a.target
      ? exported.find(
          (e) => e.brand === 'capability' && e.file === a.target!.file && e.name === a.target!.name,
        )
      : undefined
    if (!target) {
      diagnostics.push({
        code: 'E_BOUND_UNRESOLVED',
        file: a.export.file,
        subject: a.export.local,
        detail: `its capability, ${a.describe}, isn't a capability exported from a capabilities.ts`,
      })
      continue
    }
    const definition = capabilities.get(target.id)
    for (const field of a.alsoSets)
      for (const defined of REDEFINES[field] ?? [])
        if (definition?.[defined] !== undefined)
          diagnostics.push({
            code: 'E_BOUND_REDEFINES',
            file: a.export.file,
            subject: a.export.local,
            detail: `${field} redefines the capability's ${defined}`,
          })
    bindings.push({
      capability: target.id,
      address: { route: a.route, action: a.action },
      export: a.export,
      params: {},
      guards: {},
    })
  }

  // the bindings the manifest lists, and the extractor's source wherever its provenance is used
  manifest.bindings = [
    ...(manifest.bindings ?? []),
    ...bindings.map((b) => ({
      capability: b.capability,
      protocol: 'affordances/v0',
      address: b.address,
    })),
  ]
  if (usesSource && !(manifest.sources ?? []).some((s) => s.id === SOURCE.id))
    (manifest.sources ??= []).push({ ...SOURCE })
  return {
    manifest,
    bindings: bindings.toSorted((x, y) => byCodeUnit(x.capability, y.capability)),
    diagnostics,
  }
}

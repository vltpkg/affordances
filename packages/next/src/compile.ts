import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { byCodeUnit } from './codegen.ts'
import { CATALOG, fails, type Diagnostic, type DiagnosticCode } from './diagnostics.ts'
import { evaluateModules } from './evaluator.ts'
import { extract, SOURCE, type ExtractedBinding } from './extract.ts'
import { findModules, resolveImport } from './modules.ts'

// RFC 0005 §4's pipeline: the capability modules, checked statically and evaluated twice, then what extraction recovers
// from the v0 actions, merged into one manifest, normalized and validated. A module's definition is the app's own, so
// it wins over an extracted one, and the two never silently merge. The result is manifest.json (only with a
// namespace), bindings.ts and diagnostics.json, each rewritten only when its content changes

// @affordances/ir is next's optional peer (intake, 2026-11-18): never bundled, never a dependency, and resolved from the
// app's own root, where the app installed it. An app without capabilities never loads it. These are the parts the
// pipeline uses, typed here so no declaration next emits refers to ir
type Manifest = {
  namespace?: string
  capabilities: { id: string; [k: string]: unknown }[]
  resources?: { id: string; [k: string]: unknown }[]
  sources?: { id: string; [k: string]: unknown }[]
  bindings?: { capability: string; protocol: string; address: Record<string, string> }[]
  [k: string]: unknown
}
type Ir = {
  canonicalJson: (value: unknown) => string
  digest: (manifest: Manifest) => Promise<string>
  normalize: (manifest: Manifest) => Manifest
  validate: (manifest: unknown) => {
    ok: boolean
    issues?: { code: string; at: string; message: string }[]
  }
}

/** @experimental Where the app resolves @affordances/ir from, or undefined when it isn't installed. */
export const resolveIr = (root: string): string | undefined => {
  try {
    return createRequire(path.join(root, 'package.json')).resolve('@affordances/ir')
  } catch {
    return undefined
  }
}

const loadIr = async (root: string): Promise<Ir | undefined> => {
  const file = resolveIr(root)
  return file ? ((await import(pathToFileURL(file).href)) as Ir) : undefined
}

/** @experimental One binding as bindings.ts holds it: the action that implements a capability, and how to call it. */
export type CompiledBinding = Omit<ExtractedBinding, 'protocol'>

/** @experimental What the compiler makes of an app (RFC 0005 §4). */
export type Compiled = {
  manifest?: Manifest
  // the manifest as manifest.json holds it: ir's canonical JSON (RFC 8785)
  canonical?: string
  digest?: string
  bindings: CompiledBinding[]
  diagnostics: Diagnostic[]
  // whether the build fails: an error, or a strict warning in strict mode
  failed: boolean
}

// a bound action's v0 field, and the capability field it would redefine (E_BOUND_REDEFINES)
const REDEFINES: Record<string, string[]> = {
  description: ['description'],
  input: ['input'],
  output: ['output'],
  expose: ['authorization', 'confirmation'],
  requires: ['preconditions'],
  guard: ['preconditions'],
  readOnly: ['kind'],
  effects: ['effects'],
  summary: ['confirmation'],
}

const known = (code: string): code is DiagnosticCode => Object.hasOwn(CATALOG, code)

/** @experimental Compile an app's capabilities: modules, extraction, merge, validate (RFC 0005 §4). */
export const compile = async (
  root: string,
  options: {
    namespace?: string
    owner?: { id?: string; name: string; href?: string }
    strict?: boolean
  } = {},
): Promise<Compiled> => {
  const diagnostics: Diagnostic[] = []
  const done = (rest: Omit<Compiled, 'diagnostics' | 'failed'>): Compiled => ({
    ...rest,
    diagnostics,
    // any error fails, including ir's own codes the catalog doesn't hold (E_SCHEMA); a catalogued strict
    // warning fails in strict mode
    failed: diagnostics.some(
      (d) => d.code.startsWith('E_') || (known(d.code) && fails(d.code, options.strict)),
    ),
  })

  // the modules, found and checked before anything runs
  const found = findModules(root)
  // what the walk found is reported first, so a missing peer never hides a module's own error (review of 917a50b6)
  diagnostics.push(...found.diagnostics)
  // an app with no capability modules and no namespace is a v0 app: nothing here loads, ir included (intake)
  if (found.modules.length === 0 && found.diagnostics.length === 0 && !options.namespace)
    return done({ bindings: [] })
  const ir = await loadIr(root)
  if (!ir) {
    diagnostics.push({
      code: 'E_IR_MISSING',
      file: 'package.json',
      subject: '@affordances/ir',
      detail: found.modules.length
        ? `${found.modules.length} capabilities.ts module(s) need it: install @affordances/ir, @affordances/next's optional peer`
        : "a namespace is configured, so a manifest is wanted: install @affordances/ir, @affordances/next's optional peer",
    })
    return done({ bindings: [] })
  }
  if (diagnostics.some((d) => d.code.startsWith('E_'))) return done({ bindings: [] })

  // then checked and evaluated, twice: evaluateModules runs the static checks itself, so no caller can skip them
  const identity = {
    ...(options.namespace && { namespace: options.namespace }),
    ...(options.owner && { owner: options.owner }),
  }
  const evaluated = evaluateModules(root, found.modules, identity)
  diagnostics.push(...evaluated.diagnostics)
  // no namespace: withAffordances reports W_NO_NAMESPACE once, with the line to paste, and nothing is written
  if (evaluated.reason === 'no-namespace' || !evaluated.manifest) return done({ bindings: [] })
  if (diagnostics.some((d) => d.code.startsWith('E_'))) return done({ bindings: [] })
  const manifest = JSON.parse(evaluated.manifest) as Manifest

  // what extraction recovers from the v0 actions, merged in where the modules don't already define it
  const extracted = extract(root, { strict: options.strict })
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
      ;(manifest.resources ??= []).push(r as never)
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
    manifest.capabilities.push(c as never)
    usesSource = true
    const { protocol: _, ...binding } = b
    bindings.push(binding)
  }

  // each bound action: its capability, by the module export it imports, and nothing it redefines
  for (const a of extracted.bound) {
    const actionFile = path.join(root, a.export.file)
    const from = a.capability.from && resolveImport(root, actionFile, a.capability.from)
    const target = evaluated.exported.find(
      (e) =>
        e.brand === 'capability' &&
        from !== undefined &&
        path.join(root, e.file) === from &&
        e.name === a.capability.local,
    )
    if (!target) {
      diagnostics.push({
        code: 'E_CAPABILITY_IMPORT',
        file: a.export.file,
        subject: a.export.local,
        detail: `its capability, ${a.capability.local || 'an expression'}, isn't a capability exported from a capabilities.ts`,
      })
      continue
    }
    const definition = capabilities.get(target.id) as Record<string, unknown> | undefined
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

  const normalized = ir.normalize(manifest)
  const validation = ir.validate(normalized)
  if (!validation.ok)
    for (const issue of validation.issues ?? [])
      diagnostics.push({
        code: issue.code as DiagnosticCode,
        file: '.affordances/manifest.json',
        subject: issue.at,
        detail: issue.message,
      })
  const ordered = bindings.toSorted((x, y) => byCodeUnit(x.capability, y.capability))
  if (diagnostics.some((d) => d.code.startsWith('E_'))) return done({ bindings: ordered })
  return done({
    manifest: normalized,
    canonical: ir.canonicalJson(normalized),
    digest: await ir.digest(normalized),
    bindings: ordered,
  })
}

// writes a file only when its content changes, so a build that changes nothing touches nothing (codegen.ts does too)
const writeIfChanged = (file: string, text: string) => {
  if (existsSync(file) && readFileSync(file, 'utf8') === text) return
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, text)
}

// an action file's import specifier from .affordances/, without its extension, as codegen's manifest.ts imports
const specifier = (file: string) =>
  JSON.stringify(`../${file.replace(/\.[jt]sx?$/, '')}`.replaceAll(path.sep, '/'))

/** @experimental bindings.ts: each capability id to the defineAction export that implements it (RFC 0005 §4). */
export const renderBindings = (bindings: CompiledBinding[]) => {
  const files = [...new Set(bindings.map((b) => b.export.file))].toSorted(byCodeUnit)
  const alias = new Map(files.map((f, i) => [f, `a${i}`]))
  const lines = [
    '// generated by @affordances/next: each capability, the action that implements it, and how to call it (RFC 0005 §4)',
    ...files.map((f) => `import * as ${alias.get(f)} from ${specifier(f)}`),
    '',
    'export const bindings = {',
    ...bindings.map((b) => {
      const a = alias.get(b.export.file)
      const guards = Object.entries(b.guards).map(
        ([id, g]) => `${JSON.stringify(id)}: ${alias.get(g.file)}.${g.local}`,
      )
      return `  ${JSON.stringify(b.capability)}: { action: ${a}.${b.export.local}, route: ${JSON.stringify(b.address.route)}, name: ${JSON.stringify(b.address.action)}, params: ${JSON.stringify(b.params)}, guards: { ${guards.join(', ')} } },`
    }),
    '} as const',
    '',
  ]
  return lines.join('\n')
}

/** @experimental Write the compiler's output to .affordances/: manifest.json only when there's a manifest. */
export const writeCompiled = (root: string, compiled: Compiled) => {
  const dir = path.join(root, '.affordances')
  if (compiled.canonical) writeIfChanged(path.join(dir, 'manifest.json'), `${compiled.canonical}\n`)
  writeIfChanged(path.join(dir, 'bindings.ts'), renderBindings(compiled.bindings))
  writeIfChanged(
    path.join(dir, 'diagnostics.json'),
    `${JSON.stringify({ ...(compiled.digest && { digest: compiled.digest }), diagnostics: compiled.diagnostics }, null, 2)}\n`,
  )
}

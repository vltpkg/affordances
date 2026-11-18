import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { CATALOG, fails, type Diagnostic, type DiagnosticCode } from './diagnostics.ts'
import { evaluateModules } from './evaluator.ts'
import { extract } from './extract.ts'
import type { CompiledBinding, Extraction } from './merge.ts'
import { findModules, readAliases, resolveImport } from './modules.ts'
import { byCodeUnit } from './order.ts'

// RFC 0005 §4's pipeline: the capability modules, checked statically and evaluated twice, then what extraction recovers
// from the v0 actions, merged into one manifest, normalized and validated. Synchronous, for withAffordances, and the
// build's own process never loads @affordances/ir: everything that needs ir (fromModules, the merge's normalize,
// validate and the digest) runs in the evaluator's sandboxed child. Pure and re-runnable; caching is the caller's.
// The result is manifest.json (only with a namespace), bindings.ts and diagnostics.json, each rewritten only when its
// content changes

export type { CompiledBinding } from './merge.ts'

/** @experimental What the compiler makes of an app (RFC 0005 §4). */
export type Compiled = {
  // the manifest as manifest.json holds it: ir's canonical JSON (RFC 8785), when nothing failed
  canonical?: string
  digest?: string
  bindings: CompiledBinding[]
  diagnostics: Diagnostic[]
  // whether the build fails: an error, or a strict warning in strict mode
  failed: boolean
}

/** @experimental Where the app resolves @affordances/ir from, next's optional peer, or undefined when it isn't installed. */
export const resolveIr = (root: string): string | undefined => {
  try {
    return createRequire(path.join(root, 'package.json')).resolve('@affordances/ir')
  } catch {
    return undefined
  }
}

const known = (code: string): code is DiagnosticCode => Object.hasOwn(CATALOG, code)

/** @experimental Compile an app's capabilities: modules, extraction, merge, validate (RFC 0005 §4). Synchronous. */
export const compileSync = (
  root: string,
  options: {
    namespace?: string
    owner?: { id?: string; name: string; href?: string }
    strict?: boolean
  } = {},
): Compiled => {
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

  const found = findModules(root)
  // what the walk found is reported first, so a missing peer never hides a module's own error (review of 917a50b6)
  diagnostics.push(...found.diagnostics)
  // an app with no capability modules and no namespace is a v0 app: nothing here loads, ir included (intake)
  if (found.modules.length === 0 && found.diagnostics.length === 0 && !options.namespace)
    return done({ bindings: [] })
  // an unreadable tsconfig is said, never a silent loss of every alias (review of 65d47ddb); a v0 app
  // resolves no aliases, so it's never asked
  const { unreadable } = readAliases(root)
  if (unreadable)
    diagnostics.push({
      code: 'W_TSCONFIG_UNREADABLE',
      file: unreadable.file,
      detail: unreadable.detail,
    })
  if (!resolveIr(root)) {
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

  // what extraction recovers from the v0 actions; each bound action's import resolved to a module export here, where
  // the file system is, so the child's merge needs none
  const extracted = extract(root, { strict: options.strict })
  const extraction: Extraction = {
    capabilities: extracted.capabilities,
    resources: extracted.resources,
    bindings: extracted.bindings,
    bound: extracted.bound.map((a) => {
      const from =
        a.capability.from && resolveImport(root, path.join(root, a.export.file), a.capability.from)
      return {
        route: a.route,
        action: a.action,
        export: a.export,
        ...(from &&
          a.capability.imported && {
            target: { file: path.relative(root, from), name: a.capability.imported },
          }),
        describe: a.capability.local || 'an expression',
        alsoSets: a.alsoSets,
      }
    }),
    diagnostics: extracted.diagnostics,
  }

  // checked, then evaluated twice, merged and validated, in the child (evaluateModules runs the static checks itself)
  const identity = {
    ...(options.namespace && { namespace: options.namespace }),
    ...(options.owner && { owner: options.owner }),
  }
  const evaluated = evaluateModules(root, found.modules, identity, { extraction })
  diagnostics.push(...evaluated.diagnostics)
  // no namespace: withAffordances reports W_NO_NAMESPACE once, with the line to paste, and nothing is written
  if (evaluated.reason === 'no-namespace') return done({ bindings: [] })
  return done({
    ...(evaluated.canonical && { canonical: evaluated.canonical }),
    ...(evaluated.digest && { digest: evaluated.digest }),
    bindings: evaluated.bindings ?? [],
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

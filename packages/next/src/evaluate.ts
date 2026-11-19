import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { merge, type Extraction, type ModuleManifest } from './merge.ts'

// RFC 0005 §1's evaluation, the child's side: run in a fresh process with an empty environment, by evaluator.ts, twice.
// It imports each capability module, hands every module's exports to fromModules, merges in extraction's output
// (merge.ts), and normalizes, validates and digests the result with ir. It prints all of it as data. ir is loaded
// here and only here, so the build's own process never loads it. Imports without extensions and tsconfig aliases,
// which Next apps use and Node won't resolve, go through one resolve hook. The static checks (modules.ts) ran before
// this, so a module here is data; what it throws is reported, never a crash of the build
//   node evaluate.js < '<json: { root, modules, identity, aliases, extraction? }>'

type Input = {
  root: string
  modules: string[]
  identity: { namespace?: string; owner?: { id?: string; name: string; href?: string } }
  aliases: { prefix: string; targets: string[] }[]
  // extraction's output, to merge in; without it, the modules' manifest alone
  extraction?: Extraction
  // 'check': the determinism check's run, which prints only the evaluation, the part a second run can differ in
  mode?: 'check'
}

// on stdin: extraction's output can outgrow an argument
const input = JSON.parse(readFileSync(0, 'utf8') || '{}') as Input

const TS = ['.ts', '/index.ts']
registerHooks({
  resolve(specifier, context, next) {
    // @affordances/ir, next's optional peer, resolves from the app's root, where the app installed it, never from
    // next's own location
    if (specifier === '@affordances/ir' || specifier.startsWith('@affordances/ir/'))
      return next(specifier, {
        ...context,
        parentURL: pathToFileURL(path.join(input.root, 'package.json')).href,
      })
    try {
      return next(specifier, context)
    } catch (error) {
      // an extensionless relative import, or an alias, to a .ts file
      const parent = context.parentURL ? new URL(context.parentURL).pathname : input.root
      const bases = specifier.startsWith('.')
        ? [path.resolve(path.dirname(parent), specifier)]
        : input.aliases
            .filter((a) => specifier.startsWith(a.prefix))
            .flatMap((a) => a.targets.map((t) => path.join(t, specifier.slice(a.prefix.length))))
      for (const base of bases)
        for (const ext of TS)
          try {
            return next(pathToFileURL(base + ext).href, context)
          } catch {
            // the next candidate
          }
      throw error
    }
  },
})

const out = (value: unknown) => process.stdout.write(JSON.stringify(value))

// loaded only now, after the hook, so it resolves from the app. The evaluator checked it resolves before starting this
type Ir = {
  brandOf: (value: unknown) => string | undefined
  canonicalJson: (value: unknown) => string
  normalize: (manifest: ModuleManifest) => ModuleManifest
  validate: (manifest: unknown) => {
    ok: boolean
    issues?: { code: string; at: string; message: string }[]
  }
  digestOf: (value: unknown) => Promise<string>
  fromModules: (
    modules: { file: string; exports: Record<string, unknown> }[],
    identity: unknown,
  ) => { manifest?: unknown; diagnostics: unknown[]; reason?: 'no-namespace' }
}
const ir = (await import('@affordances/ir')) as unknown as Ir
const { brandOf, canonicalJson, fromModules } = ir

const modules = []
for (const file of input.modules)
  try {
    const exports = (await import(pathToFileURL(file).href)) as Record<string, unknown>
    modules.push({ file: path.relative(input.root, file), exports: { ...exports } })
  } catch (error) {
    out({
      diagnostics: [
        {
          code: 'E_CAPABILITY_EVALUATION',
          file: path.relative(input.root, file),
          // with its cause, where the reason is: a refused fetch says only 'fetch failed' itself
          message: [error, (error as { cause?: unknown })?.cause]
            .filter(Boolean)
            .map((e) => String((e as Error)?.message ?? e).split('\n')[0])
            .join(': '),
        },
      ],
    })
    process.exit(0)
  }

const { manifest, diagnostics, reason } = fromModules(modules, input.identity as never)
// each branded definition's id, by its module and export, so a bound action's import names a capability (RFC 0005 §2.1)
const exported = modules.flatMap(({ file, exports }) =>
  Object.entries(exports).flatMap(([name, value]) => {
    const brand = brandOf(value)
    const id = (value as { definition?: { id?: unknown } } | undefined)?.definition?.id
    return (brand === 'capability' || brand === 'resource') && typeof id === 'string'
      ? [{ file, name, brand, id }]
      : []
  }),
)
// what the modules made: all a second evaluation can differ in, since the merge, normalize and validate below are pure
// functions of it and of the extraction, which both runs are given
const evaluation = {
  manifest: manifest && canonicalJson(manifest),
  diagnostics,
  exported,
  ...(reason && { reason }),
}
if (input.mode === 'check') {
  out(evaluation)
  process.exit(0)
}
if (!manifest || !input.extraction) {
  out({ ...evaluation, evaluation: JSON.stringify(evaluation) })
  process.exit(0)
}

// the merge, then ir's normalize and validate; any error, from fromModules, the merge or validate, stops the manifest
const merged = merge(manifest as ModuleManifest, exported, input.extraction)
const normalized = ir.normalize(merged.manifest)
const validation = ir.validate(normalized)
const all = [
  ...diagnostics,
  ...merged.diagnostics,
  ...(validation.issues ?? []).map((i) => ({
    code: i.code,
    file: '.affordances/manifest.json',
    subject: i.at,
    message: i.message,
  })),
]
const failed = all.some((d) => String((d as { code: string }).code).startsWith('E_'))
// the digest of the canonical bytes themselves: normalize is idempotent, so ir's digest() would normalize again for nothing
const canonical = canonicalJson(normalized)
out({
  ...(!failed && { canonical, digest: await ir.digestOf(normalized) }),
  bindings: merged.bindings,
  diagnostics: all,
  exported,
  evaluation: JSON.stringify(evaluation),
})

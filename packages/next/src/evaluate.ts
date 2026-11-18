import { registerHooks } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { canonicalJson, fromModules } from '@affordances/ir'

// RFC 0005 §1's evaluation, the child's side: run in a fresh process with an empty environment, by evaluator.ts, twice.
// It imports each capability module, hands every module's exports to fromModules, and prints the manifest's canonical
// JSON and the diagnostics, as data. Imports without extensions and tsconfig aliases, which Next apps use and Node
// won't resolve, go through one resolve hook. The static checks (modules.ts) ran before this, so a module here is
// data; what it throws is reported, never a crash of the build
//   node evaluate.js '<json: { root, modules, identity, aliases }>'

type Input = {
  root: string
  modules: string[]
  identity: { namespace?: string; owner?: { id?: string; name: string; href?: string } }
  aliases: { prefix: string; targets: string[] }[]
}

const input = JSON.parse(process.argv[2] ?? '{}') as Input

const TS = ['.ts', '/index.ts']
registerHooks({
  resolve(specifier, context, next) {
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
out({ manifest: manifest && canonicalJson(manifest), diagnostics, ...(reason && { reason }) })

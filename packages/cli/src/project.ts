import { Effect, FileSystem, Path } from 'effect'
import { CodegenError, findAppDir, generate } from '@affordances/next/codegen'
import { API_PATH } from '@affordances/next/config'
import { Codegen, NoApp } from './errors.ts'

export type Step = {
  // what happened: a file written, one left as it was, or something the person has to do
  status: 'wrote' | 'kept' | 'wrapped' | 'todo'
  path: string
  note?: string
}

const ROUTE_HANDLER = "export { GET, POST } from '@affordances/next/route'\n"
const CONFIGS = ['next.config.ts', 'next.config.mjs', 'next.config.js']

const appDir = (root: string) =>
  Effect.try({ try: () => findAppDir(root), catch: () => new NoApp({ root }) })

// codegen is sync node fs; its CodegenError (a bad actions file, say) is the person's to fix
const manifest = (root: string) =>
  Effect.try({
    try: () => generate(root),
    catch: (error) =>
      error instanceof CodegenError
        ? new Codegen({ message: error.message })
        : new Codegen({ message: String(error) }),
  })

// regenerates .affordances/manifest.ts, as withAffordances does when next loads the config
export const build = (root: string) =>
  Effect.gen(function* () {
    yield* appDir(root)
    const entries = yield* manifest(root)
    return { routes: entries.map((e) => e.route), manifest: '.affordances/manifest.ts' }
  })

// the route handler, the config wrapper, the gitignore entry, and a first manifest; each skipped when done
export const init = (root: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const steps: Step[] = []
    const rel = (file: string) => path.relative(root, file)

    const app = yield* appDir(root)
    const handler = path.join(
      app,
      ...API_PATH.split('/').filter(Boolean),
      '[[...path]]',
      'route.ts',
    )
    if (yield* fs.exists(handler)) steps.push({ status: 'kept', path: rel(handler) })
    else {
      yield* fs.makeDirectory(path.dirname(handler), { recursive: true })
      yield* fs.writeFileString(handler, ROUTE_HANDLER)
      steps.push({ status: 'wrote', path: rel(handler) })
    }

    let config: string | undefined
    for (const name of CONFIGS)
      if (!config && (yield* fs.exists(path.join(root, name)))) config = name
    if (!config)
      steps.push({ status: 'todo', path: 'next.config.ts', note: 'no Next config found' })
    else {
      const source = yield* fs.readFileString(path.join(root, config))
      const wrapped = source.replace(/export default (\w+)/, 'export default withAffordances($1)')
      if (source.includes('withAffordances')) steps.push({ status: 'kept', path: config })
      else if (wrapped === source)
        steps.push({
          status: 'todo',
          path: config,
          note: 'wrap the default export: export default withAffordances(nextConfig)',
        })
      else {
        yield* fs.writeFileString(
          path.join(root, config),
          `import { withAffordances } from '@affordances/next/config'\n${wrapped}`,
        )
        steps.push({ status: 'wrapped', path: config, note: 'with withAffordances' })
      }
    }

    const gitignore = path.join(root, '.gitignore')
    const ignored = (yield* fs.exists(gitignore)) ? yield* fs.readFileString(gitignore) : ''
    if (ignored.split('\n').includes('.affordances'))
      steps.push({ status: 'kept', path: '.gitignore' })
    else {
      yield* fs.writeFileString(
        gitignore,
        `${ignored}${ignored && !ignored.endsWith('\n') ? '\n' : ''}.affordances\n`,
      )
      steps.push({ status: 'wrote', path: '.gitignore', note: 'ignores .affordances' })
    }

    const { routes } = yield* build(root)
    steps.push({
      status: 'wrote',
      path: '.affordances/manifest.ts',
      note: `${routes.length} ${routes.length === 1 ? 'route' : 'routes'}`,
    })
    return { steps, routes }
  })

// @ts-check
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * @param {string} cwd
 * @returns {Record<string, any>}
 */
const readPkg = (cwd) => {
  try {
    return JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'))
  } catch {
    return {}
  }
}

/**
 * exports point at tsdown's output; each `./dist/<name>.js` was built from the entry tsdown was given,
 * which is `src/<name>.ts(x)` or `src/<name>/index.ts` (see each package's tsdown.config.ts)
 * @param {string} cwd
 * @param {string} dist
 */
const sourceOf = (cwd, dist) => {
  const name = dist.match(/^\.\/dist\/(.+)\.js$/)?.[1]
  if (!name) return
  return [`src/${name}.ts`, `src/${name}.tsx`, `src/${name}/index.ts`]
    .map((file) => join(cwd, file))
    .find((file) => existsSync(file))
}

/**
 * the typedoc options for one package, or undefined to leave it out
 * @param {string} cwd
 * @returns {undefined | { name: string, description?: string, readme?: string, entryPoints: string[] }}
 */
export default (cwd) => {
  const pkg = readPkg(cwd)
  // private workspaces (e.g. @affordances/ui) are not part of the docs site
  if (pkg.private || !pkg.name) return

  // code entry points from package.json exports; schemas, fixtures, and other files aren't code.
  // bins (cli.ts) have no export, so they're never entry points
  const entryPoints = Object.values(pkg.exports ?? {})
    .map((p) => (typeof p === 'string' ? p : p.default))
    .filter((p) => typeof p === 'string')
    .map((p) => sourceOf(cwd, p))
    .filter((p) => p !== undefined)
  if (!entryPoints.length) return

  const readme = join(cwd, 'README.md')
  return {
    name: pkg.name,
    description: pkg.description,
    ...(existsSync(readme) && { readme }),
    entryPoints,
  }
}

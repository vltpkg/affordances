import { execFileSync } from 'node:child_process'
import { builtinModules } from 'node:module'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, expect, test } from 'vitest'

// a published package's declarations import only what it declares (dependencies, peers, optional dependencies),
// itself, or Node's built-ins: never a devDependency or a dependency's own dependency, which a strict install (vlt,
// pnpm) doesn't put where its types can find it, so skipLibCheck: false fails with TS2307. next's index.d.ts did, on
// @standard-schema/spec, core's dependency (intake, 2026-11-18). One sweep over every published package

const repo = path.join(import.meta.dirname, '..', '..', '..')
const builtins = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)])
const packageOf = (specifier: string) =>
  specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]!
// every bare specifier a declaration file names: import and export … from, import(), import x =, /// reference types
const SPECIFIER = /(?:from\s+|import\s*\(\s*|import\s+|reference\s+types=)["']([^"'./][^"']*)["']/g

const undeclared = (pkgDir: string, dist: string) => {
  const pj = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8')) as Record<
    string,
    unknown
  >
  const declared = new Set([
    pj.name as string,
    ...['dependencies', 'peerDependencies', 'optionalDependencies'].flatMap((k) =>
      Object.keys((pj[k] as Record<string, string> | undefined) ?? {}),
    ),
  ])
  const found: string[] = []
  for (const f of readdirSync(dist, { recursive: true, encoding: 'utf8' }).toSorted()) {
    if (!/\.d\.[cm]?ts$/.test(f)) continue
    for (const [, s] of readFileSync(path.join(dist, f), 'utf8').matchAll(SPECIFIER)) {
      const name = packageOf(s!)
      if (!builtins.has(s!) && !builtins.has(name) && !declared.has(name))
        found.push(`${f}: ${name}`)
    }
  }
  return [...new Set(found)]
}

const scratch: string[] = []
afterAll(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true })
})

test('next’s declarations, freshly built, import only what next declares', () => {
  // its own scratch build: dist/ is rebuilt by dist.test, so reading it here could race
  const out = mkdtempSync(path.join(tmpdir(), 'affordances-next-dts-'))
  scratch.push(out)
  execFileSync(path.join(repo, 'node_modules', '.bin', 'tsdown'), ['--out-dir', out], {
    cwd: path.join(repo, 'packages', 'next'),
    stdio: 'ignore',
  })
  expect(undeclared(path.join(repo, 'packages', 'next'), out)).toEqual([])
}, 180_000)

test('every other published package’s declarations import only what it declares', () => {
  const published = readdirSync(path.join(repo, 'packages')).filter((dir) => {
    const file = path.join(repo, 'packages', dir, 'package.json')
    return dir !== 'next' && existsSync(file) && !JSON.parse(readFileSync(file, 'utf8')).private
  })
  expect(published.length).toBeGreaterThan(4)
  const findings = published.map((dir) => {
    const dist = path.join(repo, 'packages', dir, 'dist')
    // the workspace build runs before the tests (root checks), so a missing dist is a missing build, said so
    return {
      dir,
      found: existsSync(dist)
        ? undeclared(path.join(repo, 'packages', dir), dist)
        : ['no dist: build first'],
    }
  })
  expect(findings.filter((f) => f.found.length)).toEqual([])
})

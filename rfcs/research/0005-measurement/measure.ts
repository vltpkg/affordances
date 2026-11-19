// RFC 0005 §7's measurement run (SCORING.md §1): M6's extractor over apps/example and hosting-lab's v0 rewrite, at
// stage A (as written) and stage B (after the id codemod), each written in the references' form. SPIKE: run it only
// in a clean export of the tip, never in the working tree, since stage B rewrites the apps' files:
//   node --experimental-strip-types rfcs/research/0005-measurement/measure.ts <out-dir>
import { cpSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { writeIds } from '../../../packages/next/src/codegen.ts'
import { extract } from '../../../packages/next/src/extract.ts'

const here = import.meta.dirname
const repo = path.join(here, '..', '..', '..')
const out = process.argv[2]
if (!out) throw new Error('usage: measure.ts <out-dir>')
mkdirSync(out, { recursive: true })

// hosting-lab's v0 rewrite: a copy of the app, with its actions files replaced by hosting-lab-v0/'s (SCORING.md §3)
const v0 = path.join(repo, 'apps', 'hosting-lab-v0-measurement')
rmSync(v0, { recursive: true, force: true })
cpSync(path.join(repo, 'apps', 'hosting-lab'), v0, { recursive: true, verbatimSymlinks: true })
const rewrite = path.join(here, 'hosting-lab-v0')
for (const rel of readdirSync(rewrite, { recursive: true, encoding: 'utf8' }))
  if (rel.endsWith('.ts')) cpSync(path.join(rewrite, rel), path.join(v0, rel))

const withoutSchema = (schema: unknown) => {
  if (!schema || typeof schema !== 'object') return schema ?? null
  const { $schema: _drop, ...rest } = schema as Record<string, unknown>
  return rest
}

// one extraction, in the references' form, with its diagnostics
const project = (root: string) => {
  const x = extract(root)
  const bindingOf = new Map(x.bindings.map((b) => [b.capability, b.address]))
  return {
    resources: x.resources.map((r) => ({ id: r.id, key: r.key })),
    capabilities: x.capabilities.map((c) => ({
      id: c.id,
      kind: c.kind,
      description: c.description ?? null,
      binding: bindingOf.get(c.id) ?? null,
      target: c.target ?? null,
      input: withoutSchema(c.input),
      authorization: c.authorization ? { principal: c.authorization.principal } : null,
      confirmation: c.confirmation ? { summary: c.confirmation.summary } : null,
      preconditions: (c.preconditions ?? []).map((p) => ({
        id: p.id,
        description: p.description,
        declarative: false,
      })),
      effects: [],
      claims: [],
      relations: [],
    })),
    diagnostics: x.diagnostics.map((d) => ({
      code: d.code,
      file: d.file,
      subject: d.subject ?? null,
    })),
  }
}

for (const [name, root] of [
  ['example', path.join(repo, 'apps', 'example')],
  ['hosting-lab', v0],
] as const) {
  writeFileSync(path.join(out, `${name}-A.json`), `${JSON.stringify(project(root), null, 2)}\n`)
  const written = writeIds(root)
  writeFileSync(
    path.join(out, `${name}-B.json`),
    `${JSON.stringify({ codemod: written.length, ...project(root) }, null, 2)}\n`,
  )
}
rmSync(v0, { recursive: true, force: true })
console.log(`wrote ${out}`)

import { spawnSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { findAppDir } from './codegen.ts'
import type { Diagnostic } from './diagnostics.ts'
import type { CompiledBinding, Extraction } from './merge.ts'
import { aliasesOf, checkModule } from './modules.ts'

// RFC 0005 §1's evaluation, the parent's side: the capability modules run in a child (evaluate.ts), never in the
// build's own process, and twice, each time fresh, with an empty environment. If the two manifests differ by a byte,
// the build refuses with E_CAPABILITY_NONDETERMINISTIC, showing where. The child runs under Node's permission model:
// it reads only the app dir, the node_modules it resolves from and its own code, and can't write, connect or spawn

/** @experimental The manifest the capability modules make, as canonical JSON, with what fromModules reported. */
export type Evaluated = {
  // the modules' manifest alone, when no extraction was given
  manifest?: string
  // with an extraction: the merged, normalized, validated manifest as canonical JSON, and its digest, when nothing failed
  canonical?: string
  digest?: string
  bindings?: CompiledBinding[]
  diagnostics: Diagnostic[]
  // each branded capability and resource, by module (relative to the root) and export name
  exported: { file: string; name: string; brand: 'capability' | 'resource'; id: string }[]
  reason?: 'no-namespace'
}

type ChildDiagnostic = {
  code: string
  file?: string
  line?: number
  subject?: string
  // fromModules and validate say message; the merge's diagnostics already say detail
  message?: string
  detail?: string
}
type ChildOutput = {
  exported?: Evaluated['exported']
  manifest?: string
  canonical?: string
  digest?: string
  bindings?: CompiledBinding[]
  diagnostics?: ChildDiagnostic[]
  reason?: 'no-namespace'
}

const here = path.dirname(fileURLToPath(import.meta.url))
// the child program beside this file: evaluate.ts in the source, evaluate.js once built
const childProgram = () =>
  ['evaluate.js', 'evaluate.ts'].map((f) => path.join(here, f)).find((f) => existsSync(f))!

// what the child may read: the app dir, every node_modules from the root up (with the store their links point into),
// its own code, and @affordances/ir where the app resolves it
const readable = (root: string, appDir: string) => {
  const dirs = [appDir, here]
  for (let d = path.resolve(root); ; d = path.dirname(d)) {
    const nm = path.join(d, 'node_modules')
    if (existsSync(nm)) dirs.push(nm, realpathSync(nm))
    if (path.dirname(d) === d) break
  }
  // @affordances/ir, where the app resolves it: its package dir, through any link into a store
  try {
    const entry = realpathSync(
      createRequire(path.join(root, 'package.json')).resolve('@affordances/ir'),
    )
    dirs.push(path.dirname(entry), path.resolve(path.dirname(entry), '..'))
  } catch {
    // not installed: the pipeline reports E_IR_MISSING before the evaluator runs
  }
  return [...new Set(dirs)]
}

const toDiagnostic = (d: ChildDiagnostic): Diagnostic => ({
  code: d.code as Diagnostic['code'],
  file: d.file ?? 'capabilities.ts',
  ...(d.line !== undefined && { line: d.line }),
  ...(d.subject && { subject: d.subject }),
  ...((d.message ?? d.detail) !== undefined && { detail: d.message ?? d.detail }),
})

/**
 * @internal The evaluation alone, twice in the sandbox, WITHOUT the static checks: only for tests of the layers behind
 * those checks (the run-twice guard, the permission model), which a module has to get past the checks to reach. Every
 * caller evaluates through evaluateModules, which runs the checks first. No package entry exports this
 */
export const evaluateUnchecked = (
  root: string,
  modules: string[],
  identity: { namespace?: string; owner?: { id?: string; name: string; href?: string } },
  options: { timeoutMs?: number; extraction?: Extraction } = {},
): Evaluated => {
  const appDir = findAppDir(root)
  // on stdin, since extraction's output can outgrow an argument
  const input = JSON.stringify({
    root,
    modules,
    identity,
    aliases: aliasesOf(root),
    ...(options.extraction && { extraction: options.extraction }),
  })
  const run = () =>
    spawnSync(
      process.execPath,
      [
        '--permission',
        ...readable(root, appDir).map((d) => `--allow-fs-read=${d}`),
        childProgram(),
      ],
      {
        cwd: appDir,
        input,
        // next's types make NODE_ENV required; the child gets none, on purpose
        env: {} as NodeJS.ProcessEnv,
        encoding: 'utf8',
        timeout: options.timeoutMs ?? 60_000,
      },
    )
  const failed = (why: string): Evaluated => ({
    diagnostics: [
      { code: 'E_CAPABILITY_EVALUATION', file: path.relative(root, appDir), detail: why },
    ],
    exported: [],
  })
  const first = run()
  if (first.error || first.status !== 0)
    return failed(
      first.error?.message ?? (first.stderr.trim().split('\n').at(-1) || `exit ${first.status}`),
    )
  const second = run()
  // the second run is checked as the first is: a crash there is no evidence of determinism (review of 3959720b)
  if (second.error || second.status !== 0)
    return failed(
      second.error?.message ?? (second.stderr.trim().split('\n').at(-1) || `exit ${second.status}`),
    )
  if (second.stdout !== first.stdout) {
    let at = 0
    while (at < first.stdout.length && first.stdout[at] === second.stdout[at]) at++
    return {
      diagnostics: [
        {
          code: 'E_CAPABILITY_NONDETERMINISTIC',
          file: path.relative(root, appDir),
          detail: `the two evaluations first differ at byte ${at}: …${first.stdout.slice(Math.max(0, at - 40), at + 40)}…`,
        },
      ],
      exported: [],
    }
  }
  let output: ChildOutput
  try {
    output = JSON.parse(first.stdout) as ChildOutput
  } catch {
    return failed(`the evaluation printed no result: ${first.stderr.trim().split('\n')[0] ?? ''}`)
  }
  return {
    ...(output.manifest && { manifest: output.manifest }),
    ...(output.canonical && { canonical: output.canonical }),
    ...(output.digest && { digest: output.digest }),
    ...(output.bindings && { bindings: output.bindings }),
    diagnostics: (output.diagnostics ?? []).map(toDiagnostic),
    exported: output.exported ?? [],
    ...(output.reason && { reason: output.reason }),
  }
}

/** @experimental Evaluate the capability modules twice, each in a fresh child, and compare (RFC 0005 §1). The static
 * checks run first, here, so no caller can evaluate a module that hasn't passed them (review of 917a50b6) */
export const evaluateModules = (
  root: string,
  modules: string[],
  identity: { namespace?: string; owner?: { id?: string; name: string; href?: string } },
  options: { timeoutMs?: number; extraction?: Extraction } = {},
): Evaluated => {
  const checked = modules.flatMap((m) => checkModule(root, m))
  if (checked.some((d) => d.code.startsWith('E_'))) return { diagnostics: checked, exported: [] }
  return evaluateUnchecked(root, modules, identity, options)
}

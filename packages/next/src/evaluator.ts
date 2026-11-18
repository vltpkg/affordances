import { spawnSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { findAppDir } from './codegen.ts'
import type { Diagnostic } from './diagnostics.ts'
import { aliasesOf } from './modules.ts'

// RFC 0005 §1's evaluation, the parent's side: the capability modules run in a child (evaluate.ts), never in the
// build's own process, and twice, each time fresh, with an empty environment. If the two manifests differ by a byte,
// the build refuses with E_CAPABILITY_NONDETERMINISTIC, showing where. The child runs under Node's permission model:
// it reads only the app dir, the node_modules it resolves from and its own code, and can't write, connect or spawn

/** @experimental The manifest the capability modules make, as canonical JSON, with what fromModules reported. */
export type Evaluated = {
  manifest?: string
  diagnostics: Diagnostic[]
  reason?: 'no-namespace'
}

type ChildOutput = {
  manifest?: string
  diagnostics?: { code: string; file?: string; subject?: string; message: string }[]
  reason?: 'no-namespace'
}

const here = path.dirname(fileURLToPath(import.meta.url))
// the child program beside this file: evaluate.ts in the source, evaluate.js once built
const childProgram = () =>
  ['evaluate.js', 'evaluate.ts'].map((f) => path.join(here, f)).find((f) => existsSync(f))!

// what the child may read: the app dir, every node_modules from the root up (with the store their links point into),
// its own code, and @affordances/ir wherever it resolves from, when it isn't inlined
const readable = (root: string, appDir: string) => {
  const dirs = [appDir, here]
  for (let d = path.resolve(root); ; d = path.dirname(d)) {
    const nm = path.join(d, 'node_modules')
    if (existsSync(nm)) dirs.push(nm, realpathSync(nm))
    if (path.dirname(d) === d) break
  }
  try {
    dirs.push(path.dirname(realpathSync(createRequire(import.meta.url).resolve('@affordances/ir'))))
    dirs.push(
      path.resolve(
        path.dirname(realpathSync(createRequire(import.meta.url).resolve('@affordances/ir'))),
        '..',
      ),
    )
  } catch {
    // inlined in the built evaluator: nothing to read
  }
  return [...new Set(dirs)]
}

const toDiagnostic = (d: {
  code: string
  file?: string
  subject?: string
  message: string
}): Diagnostic => ({
  code: d.code as Diagnostic['code'],
  file: d.file ?? 'capabilities.ts',
  ...(d.subject && { subject: d.subject }),
  detail: d.message,
})

/** @experimental Evaluate the capability modules twice, each in a fresh child, and compare (RFC 0005 §1). */
export const evaluateModules = (
  root: string,
  modules: string[],
  identity: { namespace?: string; owner?: { id?: string; name: string; href?: string } },
  options: { timeoutMs?: number } = {},
): Evaluated => {
  const appDir = findAppDir(root)
  const arg = JSON.stringify({ root, modules, identity, aliases: aliasesOf(root) })
  const run = () =>
    spawnSync(
      process.execPath,
      [
        '--permission',
        ...readable(root, appDir).map((d) => `--allow-fs-read=${d}`),
        childProgram(),
        arg,
      ],
      {
        cwd: appDir,
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
  })
  const first = run()
  if (first.error || first.status !== 0)
    return failed(
      first.error?.message ?? (first.stderr.trim().split('\n').at(-1) || `exit ${first.status}`),
    )
  const second = run()
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
    diagnostics: (output.diagnostics ?? []).map(toDiagnostic),
    ...(output.reason && { reason: output.reason }),
  }
}

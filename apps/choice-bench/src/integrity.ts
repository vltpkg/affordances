import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { cpus, loadavg } from 'node:os'
import path from 'node:path'
import { configRoots } from './drivers/isolation.ts'

// two of M5's integrity steps, as the surface run applies them (surfaces/PLAN.md §6)

/**
 * The owner's files, stamped before and after every run (intake, 2026-11-18 09:03Z): each one's mtime and sha256, as
 * the exploratory run recorded them. Recorded, never refused: the Claude CLI refreshes its own credentials, and many
 * of the host's processes share the real config dir, so a change is reported, with its time, for intake to read.
 * Only a digest of a credentials file is kept, never its bytes.
 */
export const ownerFiles = () => {
  const roots = configRoots()
  return [
    path.join(roots.claude, 'settings.json'),
    path.join(roots.claude, '.credentials.json'),
    path.join(roots.codex, 'AGENTS.md'),
    path.join(roots.codex, 'config.toml'),
    path.join(roots.codex, 'auth.json'),
  ]
}
export type OwnerStamp = { file: string; mtime: string | null; sha256: string | null }
export const stampOwnerFiles = (files = ownerFiles()): OwnerStamp[] =>
  files.map((file) =>
    existsSync(file)
      ? {
          file,
          mtime: new Date(statSync(file).mtimeMs).toISOString(),
          sha256: createHash('sha256').update(readFileSync(file)).digest('hex'),
        }
      : { file, mtime: null, sha256: null },
  )
/** The files whose stamp changed between two stampings, with both stamps. */
export const ownerChanges = (before: OwnerStamp[], after: OwnerStamp[]) =>
  after.flatMap((a) => {
    const b = before.find((x) => x.file === a.file)
    return b && b.mtime === a.mtime && b.sha256 === a.sha256
      ? []
      : [{ file: a.file, before: b ?? null, after: a }]
  })

/**
 * M5's load gate (intake, 04:27Z): a run starts only once the 1-minute load average is under twice the host's cores,
 * waiting for it, and records the load it started at and how long it waited. Load is recorded per trial as well.
 */
export const loadGate = async (
  options: { limit?: number; pollMs?: number; maxWaitMs?: number; load?: () => number } = {},
) => {
  const limit = options.limit ?? 2 * cpus().length
  const load = options.load ?? (() => loadavg()[0]!)
  const started = Date.now()
  for (;;) {
    const now = load()
    if (now < limit) return { limit, load: now, waitedMs: Date.now() - started }
    if (Date.now() - started >= (options.maxWaitMs ?? Number.POSITIVE_INFINITY))
      throw new Error(`the load stayed at or above ${limit} for ${options.maxWaitMs}ms`)
    await new Promise((resolve) => setTimeout(resolve, options.pollMs ?? 15_000))
  }
}

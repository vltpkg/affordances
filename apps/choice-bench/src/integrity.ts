import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
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
const ownerFiles = () => {
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

// the two credential files (intake, 2026-11-18 18:22Z): their digests are written only to an out-of-git sidecar, so a
// run's records carry 'recorded outside git' by design, and no committed record ever needs a hand edit
const CREDENTIAL_FILES = ['.credentials.json', 'auth.json']
export const OUTSIDE_GIT = 'recorded outside git'
const isCredential = (file: string) => CREDENTIAL_FILES.some((name) => path.basename(file) === name)

const stamp = (file: string): OwnerStamp =>
  existsSync(file)
    ? {
        file,
        mtime: new Date(statSync(file).mtimeMs).toISOString(),
        sha256: createHash('sha256').update(readFileSync(file)).digest('hex'),
      }
    : { file, mtime: null, sha256: null }

/**
 * The owner's files stamped. The full stamps go to the sidecar, when one is given: a file outside the run's results
 * directory, and so outside its archive. The stamps returned, which the run's records carry, have the credential
 * files' digests as 'recorded outside git'.
 */
export const stampOwnerFiles = (files = ownerFiles(), sidecar?: string): OwnerStamp[] => {
  const full = files.map(stamp)
  if (sidecar) {
    mkdirSync(path.dirname(sidecar), { recursive: true })
    writeFileSync(sidecar, `${JSON.stringify(full, null, 2)}\n`)
  }
  return full.map((s) => (isCredential(s.file) && s.sha256 ? { ...s, sha256: OUTSIDE_GIT } : s))
}

// a stamp as a record shows it: a credential file's digest 'recorded outside git'
const shown = (s: OwnerStamp | undefined) =>
  s && isCredential(s.file) && s.sha256 ? { ...s, sha256: OUTSIDE_GIT } : (s ?? null)

/**
 * The files whose stamp changed between two stampings, compared in full, from the sidecars. A credential file's change
 * is reported by its mtimes and a changed flag, never its digest.
 */
export const ownerChanges = (before: OwnerStamp[], after: OwnerStamp[]) =>
  after.flatMap((a) => {
    const b = before.find((x) => x.file === a.file)
    if (b && b.mtime === a.mtime && b.sha256 === a.sha256) return []
    return [{ file: a.file, changed: true, before: shown(b), after: shown(a) }]
  })

/** A sidecar's full stamps. */
export const readStamps = (sidecar: string) =>
  JSON.parse(readFileSync(sidecar, 'utf8')) as OwnerStamp[]

/** Where a run's sidecar goes: beside its results directory, never in it, so the archive never holds it. */
export const sidecarFor = (out: string, launch: number, when: 'before' | 'after') =>
  path.join(path.dirname(out), '.owner-stamps', `${path.basename(out)}-${launch}-${when}.json`)

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

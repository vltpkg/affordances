import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// a trial's isolation (intake, the planner and review, 2026-11-18, after the pilot's context diagnostic). The pilot's
// Claude trials ran inside the repo and got the seat's memory index and a git block; its Codex trials got the user's
// global AGENTS.md. Trials use the real config dirs, so a CLI's credential refresh writes the real file as normal use
// does, and the harness never copies, writes or deletes anything there. Each contamination source is closed instead:
// the cwd is outside any git tree and any CLAUDE.md or AGENTS.md, memory and CLAUDE.md loading are switched off, and
// the context canary proves it before a run

export class NotIsolated extends Error {}

// the seat's own directory for everything a run keeps outside the repo, and outside /tmp, which other users share. One
// constant, so the trials and the canary baselines can't name two different places
export const SEAT_ROOT = path.join(
  os.homedir(),
  '.cache',
  'affordances-exports',
  'build-backend-engineer',
)

// the dedicated root for trial working directories
export const TRIALS_ROOT = path.join(SEAT_ROOT, 'trials')

/** Whether a real-model run's results directory is under the trials root, as every one must be. */
export const underTrialsRoot = (dir: string) =>
  path.resolve(dir).startsWith(`${TRIALS_ROOT}${path.sep}`)

// every directory from dir up to the root
const ancestors = (dir: string) => {
  const out: string[] = []
  for (let at = path.resolve(dir); ; at = path.dirname(at)) {
    out.push(at)
    if (path.dirname(at) === at) return out
  }
}

// what in a trial's cwd, or above it, would put instructions or a git block in an agent's context
export const contextLeaks = (dir: string): string[] => {
  const leaks: string[] = []
  const resolved = path.resolve(dir)
  for (const tmp of new Set([path.resolve(os.tmpdir()), '/tmp']))
    if (resolved === tmp || resolved.startsWith(`${tmp}${path.sep}`))
      leaks.push(`${dir} is under ${tmp}, which other users share`)
  for (const at of ancestors(dir))
    for (const name of ['.git', 'CLAUDE.md', 'AGENTS.md', 'CLAUDE.local.md'])
      if (existsSync(path.join(at, name))) leaks.push(path.join(at, name))
  // a work tree can also be named by a parent's gitdir file or GIT_DIR; ask git itself
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: dir,
      stdio: 'pipe',
      env: { PATH: process.env.PATH },
    })
    leaks.push(`${dir} is inside a git work tree`)
  } catch {
    // not a work tree: the clean case
  }
  return leaks
}

// the real config dirs, as the CLIs resolve them; read, never written
export const configRoots = () => ({
  claude: process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude'),
  codex: process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex'),
})

// Claude keys a project's transcripts and memory by its cwd, with each non-alphanumeric character a dash. A trial's
// cwd is fresh, so its key must not exist before the run, and nothing may appear under it after
export const claudeKey = (dir: string) => path.resolve(dir).replace(/[^A-Za-z0-9]/g, '-')

const filesUnder = (root: string): string[] =>
  existsSync(root)
    ? readdirSync(root, { recursive: true, encoding: 'utf8' }).filter((f) =>
        statSync(path.join(root, f)).isFile(),
      )
    : []

// refuse a trial that isn't isolated, before its CLI starts
export const assertIsolated = (dir: string, roots = configRoots()) => {
  const leaks = contextLeaks(dir)
  const key = path.join(roots.claude, 'projects', claudeKey(dir))
  if (existsSync(key)) leaks.push(`the trial's Claude project key already exists: ${key}`)
  if (leaks.length) throw new NotIsolated(`the trial isn't isolated: ${leaks.join('; ')}`)
}

// what a CLI run left in the real config dirs: the harness lists it and deletes nothing (the planner's ruling B)
export type Footprint = {
  claude: string[] // files under the trial's own project key: memory or a transcript, which shouldn't exist
  codex: string[] // session files that appeared during the run
}
export const codexSessions = (roots = configRoots()) =>
  new Set(filesUnder(path.join(roots.codex, 'sessions')))
export const footprintOf = (
  dir: string,
  codexBefore: Set<string>,
  roots = configRoots(),
): Footprint => ({
  claude: filesUnder(path.join(roots.claude, 'projects', claudeKey(dir))).map((f) =>
    path.join('projects', claudeKey(dir), f),
  ),
  codex: [...codexSessions(roots)]
    .filter((f) => !codexBefore.has(f))
    .map((f) => path.join('sessions', f)),
})

// a status command's exit code and both streams: codex prints its status to stderr (the calibration canary's first
// preflight refused on a stdout-only read, 2026-11-18)
type Status = { code: number | null; stdout: string; stderr: string }
const statusOf = (command: string, args: string[]): Status => {
  const r = spawnSync(command, args, { encoding: 'utf8' })
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

// whether each status says logged in. Claude's is JSON with loggedIn; codex's is a line on either stream that starts
// 'Logged in', where 'Not logged in' must not count
export const readLogins = (claude: Status, codex: Status) => {
  let claudeLoggedIn = false
  try {
    claudeLoggedIn =
      claude.code === 0 && (JSON.parse(claude.stdout) as { loggedIn?: boolean }).loggedIn === true
  } catch {
    // not JSON: not logged in, as far as the record goes
  }
  const codexLines = `${codex.stdout}\n${codex.stderr}`.split('\n').map((l) => l.trim())
  return {
    claude: claudeLoggedIn,
    codex: codex.code === 0 && codexLines.some((l) => /^logged in\b/i.test(l)),
  }
}

// the logins, read-only, before and after a run: each CLI's own status command, never login, logout or refresh
export const loginStatus = () => ({
  at: new Date().toISOString(),
  ...readLogins(statusOf('claude', ['auth', 'status']), statusOf('codex', ['login', 'status'])),
})

// the secret strings in the real credentials, read only to scan results: every string value long enough to be a token
export const credentialSecrets = (roots = configRoots()): string[] => {
  const out: string[] = []
  const walk = (v: unknown) => {
    if (typeof v === 'string') {
      if (v.length >= 16) out.push(v)
    } else if (v && typeof v === 'object') Object.values(v).forEach(walk)
  }
  for (const file of [
    path.join(roots.claude, '.credentials.json'),
    path.join(roots.codex, 'auth.json'),
  ])
    if (existsSync(file)) walk(JSON.parse(readFileSync(file, 'utf8')))
  return out
}

// one pass over a run's results, each file read once: the files holding any credential's secret, which a run's
// results must hold none of, and how often the user's address appears, as counts only, never the address
export const scanResults = (dir: string, secrets = credentialSecrets(), email = userEmail()) => {
  const hits: string[] = []
  let files = 0
  let occurrences = 0
  for (const rel of filesUnder(dir)) {
    const text = readFileSync(path.join(dir, rel), 'latin1')
    if (secrets.some((s) => text.includes(s))) hits.push(rel)
    const n = email ? text.split(email).length - 1 : 0
    if (!n) continue
    files++
    occurrences += n
  }
  return {
    secrets: hits,
    email: email
      ? { checked: true as const, found: occurrences > 0, files, occurrences }
      : { checked: false as const },
  }
}

// files under dir holding any of the secrets
export const filesWithSecrets = (dir: string, secrets = credentialSecrets()): string[] =>
  scanResults(dir, secrets, '').secrets

// the user's email, read at run time from the local git config and never written anywhere: a run's scan reports only
// whether and how often it appears (intake, 2026-11-18)
export const userEmail = (): string | undefined => {
  try {
    const email = execFileSync('git', ['config', '--global', 'user.email'], {
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim()
    return email || undefined
  } catch {
    return undefined
  }
}

// how often an address appears under dir: the files and the occurrences, never the address
export const emailScan = (dir: string, email = userEmail()) => scanResults(dir, [], email).email

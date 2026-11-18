import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// a trial's isolation (intake and the planner, 2026-11-18, after the pilot's context diagnostic). The pilot's Claude
// trials ran inside the repo and got the seat's memory index and a git block of commit subjects; its Codex trials got
// the user's global AGENTS.md. So a trial now runs only where none of that can reach it, and with a home of its own

// where throwaway homes live: the seat's on-disk export directory, never /tmp, which other users on this host share
export const HOMES_ROOT = path.join(
  os.homedir(),
  '.cache',
  'affordances-exports',
  'build-backend-engineer',
  'homes',
)

export class NotIsolated extends Error {}

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

export type Cli = 'claude' | 'codex'

// the credential each CLI needs, from the seat's own config; nothing else of it is copied
const credentialOf = (cli: Cli) =>
  cli === 'claude'
    ? path.join(
        process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude'),
        '.credentials.json',
      )
    : path.join(process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex'), 'auth.json')

export type TrialHome = { dir: string; env: Record<string, string> }

// a home for one CLI run: mode 0700, holding only the CLI's credential (mode 0600), with every config root the CLIs
// read pointed into it. So no settings, memory, AGENTS.md or history of the seat's reaches the trial, and nothing a
// seat writes mid-run can either
export const makeHome = (cli: Cli, root = HOMES_ROOT): TrialHome => {
  mkdirSync(root, { recursive: true, mode: 0o700 })
  chmodSync(root, 0o700)
  const dir = mkdtempSync(path.join(root, `${cli}-`))
  chmodSync(dir, 0o700)
  const config = path.join(dir, '.config')
  const claude = path.join(config, 'claude')
  const codex = path.join(dir, '.codex')
  for (const d of [config, claude, codex]) mkdirSync(d, { recursive: true, mode: 0o700 })
  const credential = credentialOf(cli)
  const to = path.join(cli === 'claude' ? claude : codex, path.basename(credential))
  copyFileSync(credential, to)
  chmodSync(to, 0o600)
  return {
    dir,
    env: { HOME: dir, XDG_CONFIG_HOME: config, CLAUDE_CONFIG_DIR: claude, CODEX_HOME: codex },
  }
}

// the home's memory directory, wherever the CLI would put one, must be empty
const memoryFiles = (home: TrialHome) => {
  const projects = path.join(home.env.CLAUDE_CONFIG_DIR!, 'projects')
  if (!existsSync(projects)) return []
  return readdirSync(projects, { recursive: true, encoding: 'utf8' }).filter((f) =>
    /memory/i.test(f),
  )
}

// refuse a trial that isn't isolated, before its CLI starts
export const assertIsolated = (dir: string, home: TrialHome) => {
  const leaks = [...contextLeaks(dir), ...memoryFiles(home).map((f) => `memory: ${f}`)]
  if (leaks.length) throw new NotIsolated(`the trial isn't isolated: ${leaks.join('; ')}`)
}

// the home goes the moment its run ends, however it ends
export const removeHome = (home: TrialHome) => rmSync(home.dir, { recursive: true, force: true })

// the secret strings in the seat's credentials: every string value long enough to be a token
export const credentialSecrets = (): string[] => {
  const out: string[] = []
  const walk = (v: unknown) => {
    if (typeof v === 'string') {
      if (v.length >= 16) out.push(v)
    } else if (v && typeof v === 'object') Object.values(v).forEach(walk)
  }
  for (const cli of ['claude', 'codex'] as const) {
    const file = credentialOf(cli)
    if (existsSync(file)) walk(JSON.parse(readFileSync(file, 'utf8')))
  }
  return out
}

// files under dir holding any of the secrets: a run's results must hold none (the planner's security rule)
export const filesWithSecrets = (dir: string, secrets = credentialSecrets()): string[] => {
  const hits: string[] = []
  for (const rel of readdirSync(dir, { recursive: true, encoding: 'utf8' })) {
    const file = path.join(dir, rel)
    if (!statSync(file).isFile()) continue
    const text = readFileSync(file, 'latin1')
    if (secrets.some((s) => text.includes(s))) hits.push(rel)
  }
  return hits
}

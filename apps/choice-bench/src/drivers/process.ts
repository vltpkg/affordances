import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import path from 'node:path'

// a CLI run in a fresh working directory (RFC 0003 §5.3, isolation): each stdout line with when it arrived, the
// exit code, and stdout stored whole. A run past its timeout is ended by its own pid, never by name
export type Ran = {
  dir: string
  lines: { at: number; text: string }[]
  exitCode: number
  durationMs: number
  timedOut: boolean
  raw: string
  stderr?: string // what the CLI wrote to stderr, for classifying a failure (boundary review #8)
}

export const freshDir = (root: string, prefix: string) => mkdtempSync(path.join(root, `${prefix}-`))

export const runCli = (
  command: string,
  args: string[],
  options: { dir: string; timeoutMs: number; env?: NodeJS.ProcessEnv; stdin?: string },
): Promise<Ran> =>
  new Promise((resolve, reject) => {
    const started = performance.now()
    const child = spawn(command, args, {
      cwd: options.dir,
      env: options.env ?? process.env,
      stdio: [options.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    })
    if (options.stdin !== undefined) child.stdin!.end(options.stdin)
    let out = ''
    let pending = ''
    const lines: Ran['lines'] = []
    child.stdout!.setEncoding('utf8')
    child.stdout!.on('data', (chunk: string) => {
      out += chunk
      pending += chunk
      const parts = pending.split('\n')
      pending = parts.pop()!
      const at = performance.now() - started
      for (const text of parts) if (text.trim()) lines.push({ at, text })
    })
    let err = ''
    child.stderr!.setEncoding('utf8')
    child.stderr!.on('data', (chunk: string) => (err += chunk))
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 5_000).unref()
    }, options.timeoutMs)
    child.on('error', reject)
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      if (pending.trim()) lines.push({ at: performance.now() - started, text: pending })
      const raw = path.join(options.dir, 'stdout.jsonl')
      writeFileSync(raw, out)
      if (err) writeFileSync(path.join(options.dir, 'stderr.txt'), err)
      resolve({
        dir: options.dir,
        lines,
        exitCode: code ?? (signal ? 128 : 1),
        durationMs: performance.now() - started,
        timedOut,
        raw,
        ...(err && { stderr: err }),
      })
    })
  })

// the environment a trial's CLI gets: only what running and authenticating need, nothing of the seat it was started
// from (RFC 0003 §5.3, isolation). An allow-list, so a variable nobody thought of can't carry the seat's plugins,
// hooks or messaging into a trial (review of M5a)
const ALLOWED =
  /^(PATH|HOME|USER|LOGNAME|SHELL|LANG|LC_[A-Z]+|TZ|TMPDIR|XDG_[A-Z_]+|CLAUDE_CONFIG_DIR|CLAUDE_CODE_TMPDIR|CODEX_HOME|SSL_CERT_FILE|NODE_EXTRA_CA_CERTS)$/
export const trialEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(process.env).filter(([k]) => ALLOWED.test(k)))

// a CLI's version, as it reports it, recorded with every trial (M5a)
export const versionOf = (command: string) =>
  execFileSync(command, ['--version'], { encoding: 'utf8' }).trim()

// a parsed JSONL line, or undefined for one that isn't JSON
export const json = (text: string): Record<string, unknown> | undefined => {
  try {
    const value = JSON.parse(text)
    return value !== null && typeof value === 'object' ? value : undefined
  } catch {
    return undefined
  }
}

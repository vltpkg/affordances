import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

// one surface trial's hosting-lab server (surfaces/PLAN.md §3; the planner, 2026-11-18 14:10Z): a fresh `next start`
// per trial on its worker's port, from the pinned export's one build, configured at boot by env (hosting-lab's
// src/lib/trial-env.ts), ready before the agent's first call, and stopped by its PID when the trial ends. Its start is
// timed apart from the trial, outside its window and its token counts

export type LabServer = {
  url: string
  pid: number
  // the build every trial's server must share: the preflight checks it's the same across trials
  buildId: string
  // from spawn to the health check passing, outside the trial's timed window
  startMs: number
  // the env it was started with, for the trace
  env: Record<string, string>
  stop(): Promise<void>
}

export type LabServerOptions = {
  // the built app's directory: the pinned export's apps/hosting-lab, with its .next production build
  dir: string
  port: number
  plans: readonly [string, string, string]
  session: string
  task: string
  // where the server writes every session's end state (hosting-lab's HOSTING_LAB_TRIAL_STATE_FILE): under the trial's
  // own directory, outside the app's
  stateFile: string
  // how long it may take to be ready
  readyMs?: number
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** The build id of the built app at dir: what makes two trials' pages the same pages. */
export const buildIdOf = (dir: string) => {
  const file = path.join(dir, '.next', 'BUILD_ID')
  if (!existsSync(file)) throw new Error(`${dir} has no production build (.next/BUILD_ID)`)
  return readFileSync(file, 'utf8').trim()
}

export const startLabServer = async (options: LabServerOptions): Promise<LabServer> => {
  const buildId = buildIdOf(options.dir)
  const env = {
    HOSTING_LAB_TRIAL_PLANS: options.plans.join(','),
    HOSTING_LAB_TRIAL_SESSION: options.session,
    HOSTING_LAB_TRIAL_TASK: options.task,
    HOSTING_LAB_TRIAL_STATE_FILE: path.resolve(options.stateFile),
  }
  const next = path.join(options.dir, 'node_modules', '.bin', 'next')
  const t0 = performance.now()
  // its own process group, so stopping it stops whatever it started, by the group's id, never by a name
  const child = spawn(next, ['start', '-p', String(options.port)], {
    cwd: options.dir,
    detached: true,
    stdio: 'ignore',
    // only what running needs, and the trial's configuration: no seat's environment reaches the app
    env: {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      NODE_ENV: 'production',
      ...env,
    },
  })
  if (!child.pid) throw new Error('the trial’s server didn’t start')
  const pid = child.pid
  // set by the child's exit, which the loops below wait on
  const life: { exited?: number | null } = {}
  child.on('exit', (code) => (life.exited = code))
  const url = `http://127.0.0.1:${options.port}`
  const stop = async () => {
    if (life.exited !== undefined) return
    try {
      process.kill(-pid, 'SIGTERM')
    } catch {
      return
    }
    for (let i = 0; i < 50 && life.exited === undefined; i++) await sleep(100)
    if (life.exited === undefined)
      try {
        process.kill(-pid, 'SIGKILL')
      } catch {}
  }
  // ready: the site index answers, which needs the app's manifest and routes loaded
  const deadline = Date.now() + (options.readyMs ?? 60_000)
  for (;;) {
    if (life.exited !== undefined)
      throw new Error(`the trial’s server exited (${life.exited}) before it was ready`)
    try {
      const r = await fetch(`${url}/.well-known/affordances.json`)
      if (r.ok) break
    } catch {}
    if (Date.now() > deadline) {
      await stop()
      throw new Error(`the trial’s server wasn’t ready within ${options.readyMs ?? 60_000}ms`)
    }
    await sleep(100)
  }
  return { url, pid, buildId, startMs: performance.now() - t0, env, stop }
}

/** One session's end state as the trial's server wrote it: M5's ground truth, lab.endState (the planner, 14:22Z). */
export type EndState = { plan: string; bundle: string | null; addOns: string[] }
export const readEndState = (stateFile: string, session: string): EndState | undefined => {
  if (!existsSync(stateFile)) return undefined
  const { sessions } = JSON.parse(readFileSync(stateFile, 'utf8')) as {
    sessions: Record<string, EndState>
  }
  return sessions[session]
}

// raised when the harness, not the agent, is at fault: excluded from scoring, rerun, and counted per cell
// (intake, 2026-11-18 14:24Z)
export class HarnessFault extends Error {
  readonly kind: string
  readonly detail: string
  constructor(kind: string, detail: string) {
    super(`a harness fault (${kind}): ${detail}`)
    this.kind = kind
    this.detail = detail
  }
}

/**
 * The mandatory cross-check: the state file against project.read through the trial's own session, on the plan and
 * the add-ons, the two project.read can say. A disagreement is a harness fault, never scored.
 */
export const crossCheck = async (url: string, session: string, state: EndState | undefined) => {
  const headers = { authorization: `Bearer ${session}`, 'content-type': 'application/json' }
  const view = (await (
    await fetch(`${url}/api/projection/view?policy=exhaustive`, { headers })
  ).json()) as {
    offers: { id: string; capability: string }[]
  }
  const read = view.offers.find((o) => o.capability === 'hosting.project.read')
  if (!read)
    throw new HarnessFault('cross-check', 'project.read isn’t offered to the trial’s session')
  const result = (await (
    await fetch(`${url}/api/projection/execute`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ offer: read.id }),
    })
  ).json()) as { status: string; output?: { plan?: string; addOns?: string[] } }
  const api = { plan: result.output?.plan, addOns: [...(result.output?.addOns ?? [])].toSorted() }
  const file = { plan: state?.plan, addOns: [...(state?.addOns ?? [])].toSorted() }
  if (JSON.stringify(api) !== JSON.stringify(file))
    throw new HarnessFault(
      'cross-check',
      `the state file says ${JSON.stringify(file)}, project.read says ${JSON.stringify(api)}`,
    )
  return api
}

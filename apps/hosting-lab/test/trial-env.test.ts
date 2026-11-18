import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'

// a trial's server is configured by env at boot, read once and only when set (the planner, 2026-11-18 14:10Z). Each
// case is a fresh process, as a fresh `next start` is: the reading happens at the first module load

const root = path.join(import.meta.dirname, '..')
const probe = (env: Record<string, string>) =>
  spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      [
        "const { trialEnv } = await import('./src/lib/trial-env.ts')",
        "const store = await import('./src/lib/store.ts')",
        "const { runtime } = await import('./src/lib/runtime.ts')",
        'const claims = runtime.manifest.claims.map((c) => c.id).toSorted()',
        "const { resolvers } = await import('./src/lib/resolvers.ts')",
        "const r = resolvers['hosting.plan']",
        'const nobody = { authenticated: false, attributes: {} }',
        'const keys = await r.list(nobody)',
        'const plans = Object.fromEntries(await Promise.all(keys.map(async (k) => [(await r.load(k, nobody)).attributes.slug, k])))',
        'console.log(JSON.stringify({ trialEnv, accounts: store.accountCount(), session: trialEnv?.session ? !!store.findAccount(trialEnv.session) : null, plans, claims }))',
      ].join('\n'),
    ],
    // only PATH and the case's own: no seat's environment, and no trial env unless the case sets it
    {
      cwd: root,
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '', ...env } as unknown as NodeJS.ProcessEnv,
    },
  )
const read = (env: Record<string, string>) => {
  const r = probe(env)
  if (r.status !== 0) throw new Error(r.stderr)
  return JSON.parse(r.stdout.trim().split('\n').at(-1)!) as Record<string, any>
}

test('unset, the app is as it was: no trial, no account, the catalog’s own plan ids, Pro recommended', () => {
  const r = read({})
  expect(r.trialEnv).toBeNull()
  expect(r.accounts).toBe(0)
  expect(r.claims).toContain('proRecommended')
  expect(r.claims).not.toContain('businessRecommended')
  expect(r.plans).toEqual({ hobby: 'p1', pro: 'p2', business: 'p3' })
})

test('set, once at boot: the plan-id order, the session’s account, and the task’s claim edit', () => {
  const r = read({
    HOSTING_LAB_TRIAL_PLANS: 'p3,p1,p2',
    HOSTING_LAB_TRIAL_SESSION: 's_trial_7',
    HOSTING_LAB_TRIAL_TASK: 'T6',
  })
  expect(r.trialEnv).toEqual({ plans: ['p3', 'p1', 'p2'], session: 's_trial_7', task: 'T6' })
  expect([r.accounts, r.session]).toEqual([1, true])
  // the catalog's plans, hobby, pro and business, take the ids in the given order
  expect(r.plans).toEqual({ hobby: 'p3', pro: 'p1', business: 'p2' })
  expect(r.claims).toContain('businessRecommended')
  expect(r.claims).not.toContain('proRecommended')
})

test('a plan order that isn’t one of p1, p2 and p3 refuses to start', () => {
  const r = probe({ HOSTING_LAB_TRIAL_PLANS: 'p1,p1,p2' })
  expect(r.status).not.toBe(0)
  expect(r.stderr).toMatch(/HOSTING_LAB_TRIAL_PLANS is an order of p1, p2 and p3/)
})

// the planner (14:22Z): a trial's server writes every session's end state, M5's own ground truth, to the file the
// harness names, atomically after each store change, and only when it's set
const purchase = (env: Record<string, string>) =>
  spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      [
        "const store = await import('./src/lib/store.ts')",
        "const lab = await import('./src/trial.ts')",
        "const a = store.account('s_state')",
        "store.subscribePlan(a.id, a.project.id, 'p2')",
        "console.log(JSON.stringify(lab.endState('s_state')))",
      ].join('\n'),
    ],
    {
      cwd: root,
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '', ...env } as unknown as NodeJS.ProcessEnv,
    },
  )

test('with a state file, each store change writes every session’s end state, as lab.endState reads it', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'hosting-lab-state-'))
  try {
    const file = path.join(dir, 'state.json')
    const r = purchase({ HOSTING_LAB_TRIAL_STATE_FILE: file })
    expect({ status: r.status, stderr: r.stderr }).toMatchObject({ status: 0 })
    const inProcess = JSON.parse(r.stdout.trim().split('\n').at(-1)!)
    const written = JSON.parse(readFileSync(file, 'utf8'))
    expect(written).toEqual({ sessions: { s_state: inProcess } })
    expect(inProcess).toMatchObject({ plan: 'pro', bundle: null })
    // written by renaming a temporary file, so no temporary file is left behind
    expect(readdirSync(dir)).toEqual(['state.json'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('without one, nothing is written; and a state file inside the app’s directory refuses to start', () => {
  const r = purchase({})
  expect({ status: r.status, stderr: r.stderr }).toMatchObject({ status: 0 })
  const inside = purchase({ HOSTING_LAB_TRIAL_STATE_FILE: path.join(root, 'public', 'state.json') })
  expect(inside.status).not.toBe(0)
  expect(inside.stderr).toMatch(/an absolute path outside the app’s directory/)
})

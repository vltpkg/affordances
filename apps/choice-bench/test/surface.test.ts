import { remoteRuntime } from '../src/remote.ts'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import * as lab from '@affordances/hosting-lab/trial'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, expect, test } from 'vitest'
import { fakeDriver } from '../src/drivers/fake.ts'
import type { Driver } from '../src/drivers/types.ts'
import { DriverFailure, faultsByCell, type TrialSpec } from '../src/harness.ts'
import { purchaseMade, surfaceMetrics, type SurfaceFacts } from '../src/surface-metrics.ts'
import { runSurfaceSpecs, runSurfaceTrial, surfacePromptFor } from '../src/surface.ts'
import { surfaces, type SurfaceId } from '../src/surfaces.ts'
import { setupTrial } from '../src/trial.ts'

// M7f's surface runner (the planner, 14:50Z): one runner for every surface, proven with the fake driver only

const T6 = lab.tasks.find((t) => t.id === 'T6')!
const dir = mkdtempSync(path.join(tmpdir(), 'choice-bench-surface-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

test('every surface’s prompt is the same bytes but for its one instruction line', () => {
  const prompts = Object.values(surfaces).map((s) => surfacePromptFor(s, T6).split('\n'))
  for (const p of prompts) {
    expect(p).toHaveLength(prompts[0]!.length)
    // only the second line, the instruction, differs
    expect(p.filter((line, i) => line !== prompts[0]![i]).every((line) => line === p[1])).toBe(true)
  }
  expect(new Set(prompts.map((p) => p[1])).size).toBeGreaterThan(1)
})

const facts = (over: Partial<SurfaceFacts> = {}): SurfaceFacts => ({
  surface: 'v0',
  task: 'T6',
  calls: 4,
  firstRequest: 2,
  proAllowanceSeen: true,
  completed: true,
  unauthorized: false,
  endState: { plan: 'business', bundle: null, addOns: [] },
  ...over,
})
const none = { state: undefined, replayed: [], skipped: [], alternatives: [] }

test('completed is the task’s purchase made, read from the store: a refused confirm or a non-purchase change isn’t', () => {
  const hobby = { plan: 'hobby', bundle: null, addOns: [] } as lab.EndState
  const pro = { plan: 'pro', bundle: null, addOns: [] } as lab.EndState
  // a purchase in the store counts, whichever call made it: review's two tabs, the other tab's Pro
  expect(purchaseMade(hobby, pro)).toBe(true)
  expect(purchaseMade(hobby, { ...hobby, addOns: ['daily-backups'] } as lab.EndState)).toBe(true)
  // a refused confirm leaves the store as it was, whatever the page did after
  expect(purchaseMade(hobby, hobby)).toBe(false)
  // a downgrade, or a removal, changes the state but buys nothing
  expect(purchaseMade(pro, hobby)).toBe(false)
  expect(purchaseMade({ ...pro, addOns: ['daily-backups'] } as lab.EndState, pro)).toBe(false)
})

// purchaseMade's assumption (the planner, 16:10Z), checked against the catalog so it fails loudly if it changes:
// every charge T6 can reach is monthly, or comes with a monthly charge of the same amount, and the only target that
// costs nothing is the plan every T6 trial starts on. So any purchase left in the end state raises its monthly price
test('every T6 purchase raises the monthly price: no one-time-only charge, and no free target but the start plan', async () => {
  for (const c of lab.manifest.capabilities) {
    const charges = (c.effects ?? []).filter((e) => e.category === 'financial')
    const once = charges.filter((e) => !e.amount?.per)
    const monthly = charges.filter((e) => e.amount?.per === 'month')
    expect({
      capability: c.id,
      onceWithoutMonthly: once.filter(
        (e) => !monthly.some((m) => m.amount?.value === e.amount?.value),
      ),
    }).toEqual({ capability: c.id, onceWithoutMonthly: [] })
    expect({
      capability: c.id,
      otherPeriods: charges.filter((e) => e.amount?.per && e.amount.per !== 'month'),
    }).toEqual({ capability: c.id, otherPeriods: [] })
  }
  const nobody = { authenticated: false, attributes: {} } as never
  const free: string[] = []
  for (const [type, capability] of [
    ['hosting.plan', 'hosting.plan.subscribe'],
    ['hosting.bundle', 'hosting.bundle.subscribe'],
    ['hosting.addOn', 'hosting.addOn.add'],
  ] as const) {
    const r = lab.resolvers[type]!
    for (const key of (await r.list?.(nobody, { capability })) ?? []) {
      const a = (await r.load(key, nobody))?.attributes as { slug: string; priceUsd: number }
      if (a.priceUsd <= 0) free.push(`${type}:${a.slug}`)
    }
  }
  const start = await (await setupTrial(surfaces.full.condition!, 0, 'T6')).endState()
  expect(free).toEqual([`hosting.plan:${start.plan}`])
  expect(start).toEqual({ plan: 'hobby', bundle: null, addOns: [] })
  // review (16:10Z): the start costs nothing a month, so any purchase raises it
  expect(lab.monthlyUsd(start)).toBe(0)
})

test('a consequential error is any request event’s state satisfying no reading, or an unauthorized refusal', () => {
  const truth = lab.groundTruth(T6)
  const optimal = truth.optimal[0]!
  const good = {
    plan: optimal.split('+')[0]!,
    bundle: null,
    addOns: optimal.split('+').slice(1),
  } as lab.EndState
  const bad = { plan: 'hobby', bundle: null, addOns: [] } as lab.EndState
  const run = (intended: Parameters<typeof surfaceMetrics>[1], f = facts()) =>
    surfaceMetrics(f, intended, { tokens: 1, durationMs: 1 }, 'final')
  const winner = { state: good, replayed: ['o'], skipped: [], alternatives: [] }
  expect(run(winner)).toMatchObject({ optimal: true, consequentialError: false, choseNone: false })
  expect(run({ ...winner, state: bad }).consequentialError).toBe(true)
  // a skipped request is a request event too (design, 14:57Z)
  expect(
    run({ ...winner, skipped: ['o2'], alternatives: [{ offer: 'o2', state: bad }] })
      .consequentialError,
  ).toBe(true)
  expect(run(winner, facts({ unauthorized: true })).consequentialError).toBe(true)
  expect(run(none)).toMatchObject({ choseNone: true, optimal: false, consequentialError: false })
  // intent to treat: a capped trial isn't optimal
  expect(surfaceMetrics(facts(), winner, { tokens: 1, durationMs: 1 }, 'capped').optimal).toBe(
    false,
  )
})

const build = process.env.HOSTING_LAB_BUILD
const PORT = 3913
const spec = (surface: SurfaceId, id: string, index = 1): TrialSpec =>
  ({
    id,
    condition: 'A',
    surface,
    task: 'T6',
    model: 'fake',
    driver: 'fake',
    index,
  }) as unknown as TrialSpec

test.skipIf(!build)(
  'the fake driver on full, progressive, v0 and browser: a trace with design’s metric fields, the outcome cross-checked',
  async () => {
    const at = path.join(dir, 'runs')
    let browserMetrics: Record<string, any> | undefined
    for (const [i, surface] of (['full', 'progressive', 'v0', 'browser'] as const).entries()) {
      const s = spec(surface, `${surface}-fake`)
      const r = await runSurfaceTrial(s, fakeDriver(i, path.join(at, `${s.id}.raw.json`)), at, {
        labBuild: build!,
        port: PORT,
      })
      expect(r).not.toHaveProperty('fault')
      const lines = readFileSync(path.join(at, `${s.id}.jsonl`), 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l) as Record<string, any>)
      const trial = lines[0]!
      const end = lines.find((l) => l.kind === 'end')!
      const metrics = lines.at(-1)!
      expect(trial).toMatchObject({ kind: 'trial', surface, model: { requested: 'fake' } })
      expect(trial.server.url).toBe(`http://127.0.0.1:${PORT}`)
      expect(trial.server.buildId).toMatch(/\S/)
      expect(end.traceMismatch).toBe(false)
      expect(
        [
          'optimal',
          'endOptimal',
          'choseNone',
          'completed',
          'tokens',
          'calls',
          'durationMs',
          'consequentialError',
          'proAllowanceSeen',
        ].filter((f) => !(f in metrics)),
      ).toEqual([])
      // the fake agent approves what it chose, so what it requested is what it bought, read two ways
      expect(metrics).toMatchObject({ surface, completed: true, choseNone: false })
      expect(metrics.choice).toBe(metrics.endChoice)
      // and it read the plans page or the plan list before buying, where Pro's allowance is
      expect(metrics.proAllowanceSeen).toBe(true)
      if (surface === 'browser') browserMetrics = metrics
    }
    // the browser's two pilot flags: one review load, then its confirm, so no browsing, and the same choice either way
    expect(browserMetrics).toMatchObject({
      browsingLoad: false,
      optimalConfirmLoad: browserMetrics!.optimal,
    })
  },
  600_000,
)

// the fake agent buys, then the state file is edited after it: its plan (the cross-check must catch it), or a 5xx
// the server recorded (the stall rule must)
const editing = (
  inner: Driver,
  stateFile: string,
  edit: (written: Record<string, any>) => void,
): Driver => ({
  id: 'editing',
  async run(trial) {
    const result = await inner.run(trial)
    const written = JSON.parse(readFileSync(stateFile, 'utf8')) as Record<string, any>
    edit(written)
    writeFileSync(stateFile, JSON.stringify(written))
    return result
  },
})
// the fake agent buys, then the CLI exits as a crash does, with its structured error
const crashing = (inner: Driver): Driver => ({
  id: 'crashing',
  async run(trial) {
    return { ...(await inner.run(trial)), exitCode: 1, error: 'the CLI crashed' }
  },
})

test.skipIf(!build)(
  'harness faults, an outcome disagreement or a 5xx, are set aside and counted, never scored',
  async () => {
    const at = path.join(dir, 'faults')
    const run = (s: TrialSpec, driver: Driver) =>
      runSurfaceTrial(s, driver, at, { labBuild: build!, port: PORT })
    const a = spec('full', 'disagrees')
    const disagreeing = editing(
      fakeDriver(1, path.join(at, 'a.raw.json')),
      path.join(at, `${a.id}.state.json`),
      (w) => {
        for (const s of Object.values(w.sessions) as { plan: string }[]) s.plan = 'hobby'
      },
    )
    expect(await run(a, disagreeing)).toMatchObject({ fault: { kind: 'cross-check' } })
    const b = spec('v0', 'answered-5xx')
    const failing = editing(
      fakeDriver(1, path.join(at, 'b.raw.json')),
      path.join(at, `${b.id}.state.json`),
      (w) => {
        w.serverErrors = [{ status: 500, route: '/plans', at: '' }]
      },
    )
    expect(await run(b, failing)).toMatchObject({
      fault: { kind: 'stall', detail: 'the app answered 500 on /plans' },
    })
    // neither left a trace to score, and each is counted in its cell
    expect(existsSync(path.join(at, `${a.id}.jsonl`))).toBe(false)
    expect(existsSync(path.join(at, `${b.id}.jsonl`))).toBe(false)
    expect(faultsByCell(at)).toEqual({ 'full T6 fake': 1, 'v0 T6 fake': 1 })
  },
  600_000,
)

test.skipIf(!build)(
  'a CLI driver’s crash is intake’s rule, not a fault: set aside and rerun once, then scored failed, never optimal',
  async () => {
    const at = path.join(dir, 'crashes')
    const s = spec('v0', 'crashes')
    const run = () =>
      runSurfaceTrial(s, crashing(fakeDriver(1, path.join(at, 'raw.json'))), at, {
        labBuild: build!,
        port: PORT,
      })
    await expect(run()).rejects.toThrow(DriverFailure)
    expect(existsSync(path.join(at, `${s.id}.jsonl`))).toBe(false)
    // the second crash is scored, as failed
    expect(await run()).toMatchObject({ end: 'failed', metrics: { optimal: false } })
    const lines = readFileSync(path.join(at, `${s.id}.jsonl`), 'utf8')
      .trim()
      .split('\n')
    expect(JSON.parse(lines.find((l) => l.includes('"kind":"end"'))!)).toMatchObject({
      end: 'failed',
      attempts: 2,
    })
    // and neither was a harness fault
    expect(faultsByCell(at)).toEqual({})
  },
  600_000,
)

// the planner (15:08Z): a harness fault is rerun, so the spec still gets a scored trial, and the faulted attempt is
// kept whole in interrupted/ with its reason, never deleted; and the run pauses past the threshold
const answering5xxOnce = (seed: number, at: string, stateFile: string, times = 1): Driver => {
  let left = times
  return {
    id: 'answering-5xx',
    async run(trial) {
      const inner = editing(fakeDriver(seed, path.join(at, `raw-${left}.json`)), stateFile, (w) => {
        if (left > 0) w.serverErrors = [{ status: 502, route: '/api/projection/[...op]', at: '' }]
      })
      const result = await inner.run(trial)
      left--
      return result
    },
  }
}

test.skipIf(!build)(
  'a fault on attempt 1 and a clean attempt 2: one scored trial, one counted fault, the attempt kept whole',
  async () => {
    const at = path.join(dir, 'rerun')
    const s = spec('full', 'reruns')
    const driver = answering5xxOnce(1, at, path.join(at, `${s.id}.state.json`))
    const r = await runSurfaceSpecs([s], () => driver, at, {
      labBuild: build!,
      port: PORT,
      pilot: true,
    })
    expect(r).toEqual({ missing: [], faults: 1, trialsRun: 2 })
    expect(existsSync(path.join(at, `${s.id}.jsonl`))).toBe(true)
    // the faulted attempt, moved and complete: its reason with the 5xx and the log's name, its record, state and log
    const [attempt] = readdirSync(path.join(at, 'interrupted'))
    const kept = readdirSync(path.join(at, 'interrupted', attempt!)).toSorted()
    expect(kept).toEqual(
      ['config.json', 'fault.json', 'server.json', 'server.log', 'state.json'].map(
        (f) => `${s.id}.${f}`,
      ),
    )
    const fault = JSON.parse(
      readFileSync(path.join(at, 'interrupted', attempt!, `${s.id}.fault.json`), 'utf8'),
    )
    expect(fault).toMatchObject({
      kind: 'stall',
      serverErrors: [{ status: 502, route: '/api/projection/[...op]' }],
      serverLog: `${s.id}.server.log`,
      attempt: 1,
    })
    // resumed, the scored spec isn't run again
    const again = await runSurfaceSpecs([s], () => driver, at, {
      labBuild: build!,
      port: PORT,
      pilot: true,
    })
    expect(again).toEqual({ missing: [], faults: 1, trialsRun: 2 })
  },
  600_000,
)

test.skipIf(!build)(
  'past 2 faults in the pilot, the run pauses',
  async () => {
    const at = path.join(dir, 'pause')
    const s = spec('v0', 'always-5xx')
    const driver = answering5xxOnce(1, at, path.join(at, `${s.id}.state.json`), 99)
    await expect(
      runSurfaceSpecs([s], () => driver, at, {
        labBuild: build!,
        port: PORT,
        pilot: true,
        maxAttempts: 10,
      }),
    ).rejects.toThrow(/3 harness faults in 3 trials run, more than the pilot’s 2/)
    expect(faultsByCell(at)).toEqual({ 'v0 T6 fake': 3 })
  },
  600_000,
)

// the WebMCP pilot (design, 14:10Z; the planner, 15:11Z): the page's own tools in Chromium with WebMCP on, relayed
// unchanged. The page's execute is refused for confirmation, since no browser can ask the person; the simulated
// person completes it on the review page, in the same session, and the store shows the purchase
test.skipIf(!build)(
  'the WebMCP pilot: the page’s tools, a refused purchase completed by the person on the review page',
  async () => {
    const at = path.join(dir, 'webmcp')
    const s = spec('webmcp', 'webmcp-fake')
    const r = await runSurfaceTrial(s, fakeDriver(1, path.join(at, `${s.id}.raw.json`)), at, {
      labBuild: build!,
      port: PORT,
    })
    expect(r).not.toHaveProperty('fault')
    const lines = readFileSync(path.join(at, `${s.id}.jsonl`), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l))
    const trial = lines[0]
    const metrics = lines.at(-1)
    expect(trial.webmcp.launchArgs).toEqual(['--enable-features=WebMCP'])
    // the page gives the connection its start, the user's project (intake's (b), design's c1262c57), so the first view
    // already shows what's available, and the fake agent never re-projects
    expect(lines.find((l) => l.kind === 'end').driverNotes).toBeUndefined()
    expect(trial.webmcp.aborted).toEqual([])
    expect(trial.webmcp.completions).toMatchObject([{ confirmed: true }])
    expect(metrics).toMatchObject({ surface: 'webmcp', completed: true, choseNone: false })
    expect(metrics.endChoice).toBe(metrics.choice)
  },
  600_000,
)

// the planner (14:22Z, condition 3): the same purchase through each surface ends in the same endState. The fake agent
// with seed 0 buys Pro on v0 and in the browser; lab-server.test's protocol-1 purchase of Pro ends in this same state
test.skipIf(!build)(
  'the same purchase on v0 and in the browser: the same endState, and the same intended state',
  async () => {
    const at = path.join(dir, 'same')
    const PRO = { plan: 'pro', bundle: null, addOns: [] }
    for (const surface of ['v0', 'browser'] as const) {
      const s = spec(surface, `${surface}-same`)
      const r = await runSurfaceTrial(s, fakeDriver(0, path.join(at, `${s.id}.raw.json`)), at, {
        labBuild: build!,
        port: PORT,
      })
      expect(r).not.toHaveProperty('fault')
      const lines = readFileSync(path.join(at, `${s.id}.jsonl`), 'utf8')
        .trim()
        .split('\n')
      const end = JSON.parse(lines.find((l) => l.includes('"kind":"end"'))!)
      expect({ surface, endState: end.endState }).toEqual({ surface, endState: PRO })
      expect((r as { metrics: { choice: string; completed: boolean } }).metrics).toMatchObject({
        choice: 'pro',
        completed: true,
      })
    }
  },
  600_000,
)

// the MCP pilot (the planner, 15:55Z): mcp-v1's own server over protocol 1 to the trial's server. Without
// elicitation, execute's refusal is the request event and the trial ends unconfirmed; with it accepted, the purchase
// completes, the person's approval through MCP
test.skipIf(!build)(
  'the MCP pilot: no elicitation ends unconfirmed with the intended measure; an accepted one completes',
  async () => {
    const at = path.join(dir, 'mcp')
    const results: Record<string, any> = {}
    for (const elicitation of [undefined, 'accept'] as const) {
      const s = spec('mcp', `mcp-${elicitation ?? 'none'}`)
      const r = await runSurfaceTrial(
        s,
        fakeDriver(1, path.join(at, `${s.id}.raw.json`), elicitation),
        at,
        {
          labBuild: build!,
          port: PORT,
        },
      )
      expect(r).not.toHaveProperty('fault')
      const lines = readFileSync(path.join(at, `${s.id}.jsonl`), 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l))
      results[elicitation ?? 'none'] = { trial: lines[0], metrics: lines.at(-1) }
    }
    const unconfirmed = results.none
    expect(unconfirmed.trial.mcp).toMatchObject({ declaresElicitation: false, elicitations: [] })
    expect(unconfirmed.metrics).toMatchObject({
      elicitationDeclared: false,
      completed: false,
      choseNone: false,
      endChoice: 'hobby',
    })
    const accepted = results.accept
    expect(accepted.trial.mcp.declaresElicitation).toBe(true)
    expect(accepted.trial.mcp.elicitations).toHaveLength(1)
    expect(accepted.metrics).toMatchObject({ elicitationDeclared: true, completed: true })
    expect(accepted.metrics.endChoice).toBe(accepted.metrics.choice)
    // the same request either way: the intended state doesn't depend on the confirmation
    expect(accepted.metrics.choice).toBe(unconfirmed.metrics.choice)
  },
  600_000,
)

// review's reproduction of step 4 (16:04Z), and the planner's rulings: completion is read from the store, never from
// navigation; and a refused confirm is the agent's outcome, scored, with no serverErrors entry (design's review page
// handles the runtime's refusal). Two tabs on one session: the 'other tab' buys Pro over protocol 1 while this one
// sits on Pro's review; this tab's confirm, now stale, is refused, and then it opens another page
// a snapshot's button's ref, by its exact name
const button = (snapshot: string, name: string) =>
  snapshot.match(new RegExp(`button "${name}" \\[ref=(\\w+)\\]`))![1]

const staleConfirm: Driver = {
  id: 'stale-confirm',
  async run(trial) {
    if ('url' in trial.mcp) throw new Error('a stdio server')
    const config = JSON.parse(readFileSync(trial.mcp.args[1]!, 'utf8')) as {
      url: string
      session: string
    }
    const client = new Client({ name: 'stale', version: '0' })
    await client.connect(
      new StdioClientTransport({ command: trial.mcp.command, args: trial.mcp.args }),
    )
    const trace: { name: string; input: unknown; resultBytes: number; ms: number }[] = []
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const r = (await client.callTool({ name, arguments: args })) as {
        content: { text: string }[]
      }
      trace.push({ name, input: args, resultBytes: r.content[0]!.text.length, ms: 0 })
      return r.content[0]!.text
    }
    const plans = await call('open', { path: '/plans' })
    const review = await call('click', { ref: button(plans, 'Move to Pro') })
    const [, plan, projectId] = review.match(/plan=(\w+)&projectId=(\w+)/)!
    // the other tab: the same session buys Pro through protocol 1, approving as the person does
    const rt = remoteRuntime({ base: `${config.url}/api/projection`, session: config.session })
    const view = (
      await rt.project({ principal: {} as never, policy: 'exhaustive' })
    ).view() as unknown as {
      offers: { id: string; capability: string; target?: { key: string } }[]
    }
    const pro = view.offers.find(
      (o) => o.capability === 'hosting.plan.subscribe' && o.target?.key === plan,
    )!
    const first = (await rt.execute({
      principal: {} as never,
      offer: pro.id,
      input: { plan, projectId },
    } as never)) as {
      confirmation: { approval: string }
    }
    await rt.execute({
      principal: {} as never,
      offer: pro.id,
      input: { plan, projectId },
      approval: first.confirmation.approval,
    } as never)
    // this tab's confirm, stale now, then any other page
    await call('click', { ref: button(review, 'Confirm') })
    await call('open', { path: '/plans' })
    await client.close()
    return {
      trace,
      finalText: 'done',
      usage: { inputTokens: 1, outputTokens: 1 },
      durationMs: 1,
      exitCode: 0,
      cli: { name: 'stale-confirm', version: '0' },
      raw: '',
    }
  },
}

test.skipIf(!build)(
  'a stale confirm, refused, then an open: scored, no 5xx, and completed is what the store shows',
  async () => {
    const at = path.join(dir, 'stale')
    const s = spec('browser', 'stale-confirm')
    const r = await runSurfaceTrial(s, staleConfirm, at, { labBuild: build!, port: PORT })
    // the refusal is the agent's outcome: no harness fault, and the app recorded no server error
    expect(r).not.toHaveProperty('fault')
    expect(
      JSON.parse(readFileSync(path.join(at, `${s.id}.state.json`), 'utf8')).serverErrors,
    ).toEqual([])
    const lines = readFileSync(path.join(at, `${s.id}.jsonl`), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l))
    const end = lines.find((l) => l.kind === 'end')
    const metrics = lines.at(-1)
    // the store holds the other tab's Pro, so completed is true because of the store, not the refused click: the
    // click's own call left no load off the review step
    expect(end.endState).toEqual({ plan: 'pro', bundle: null, addOns: [] })
    expect(metrics.completed).toBe(true)
  },
  600_000,
)

// the PLAN's budget (§4): one retry per trial, faults and crashes together. A spec that always faults gets two
// attempts, then is missing, never imputed; two faults don't pass the pilot's pause
test.skipIf(!build)(
  'with the pilot’s cap of two attempts, a spec that always faults is tried twice, then reported missing',
  async () => {
    const at = path.join(dir, 'capped')
    const s = spec('full', 'always-faults-capped')
    const driver = answering5xxOnce(1, at, path.join(at, `${s.id}.state.json`), 99)
    const r = await runSurfaceSpecs([s], () => driver, at, {
      labBuild: build!,
      port: PORT,
      ports: [PORT],
      pilot: true,
      maxAttempts: 2,
    })
    expect(r).toEqual({ missing: [s.id], faults: 2, trialsRun: 2 })
    expect(existsSync(path.join(at, `${s.id}.jsonl`))).toBe(false)
  },
  600_000,
)

// the planner (17:40Z): the final attempt's class decides. A crash and then a harness fault leaves the spec missing;
// a harness fault and then a crash is scored failed, under intake's rule for a CLI failure on the final attempt
const inTurn = (drivers: Driver[]): Driver => {
  let n = 0
  return { id: 'in-turn', run: (trial) => drivers[Math.min(n++, drivers.length - 1)]!.run(trial) }
}

test.skipIf(!build)(
  'a crash, then a harness fault: missing; a harness fault, then a crash: scored failed',
  async () => {
    const at = path.join(dir, 'final-class')
    const run = (s: TrialSpec, driver: Driver) =>
      runSurfaceSpecs([s], () => driver, at, {
        labBuild: build!,
        port: PORT,
        ports: [PORT],
        pilot: true,
      })
    const a = spec('full', 'crash-then-fault')
    const faultA = editing(
      fakeDriver(1, path.join(at, 'a2.raw.json')),
      path.join(at, `${a.id}.state.json`),
      (w) => {
        w.serverErrors = [{ status: 500, route: '/plans', at: '' }]
      },
    )
    expect(
      await run(a, inTurn([crashing(fakeDriver(1, path.join(at, 'a1.raw.json'))), faultA])),
    ).toMatchObject({
      missing: [a.id],
    })
    expect(existsSync(path.join(at, `${a.id}.jsonl`))).toBe(false)
    const b = spec('v0', 'fault-then-crash')
    const faultB = editing(
      fakeDriver(1, path.join(at, 'b1.raw.json')),
      path.join(at, `${b.id}.state.json`),
      (w) => {
        w.serverErrors = [{ status: 500, route: '/plans', at: '' }]
      },
    )
    expect(
      await run(b, inTurn([faultB, crashing(fakeDriver(1, path.join(at, 'b2.raw.json')))])),
    ).toMatchObject({
      missing: [],
    })
    const end = JSON.parse(
      readFileSync(path.join(at, `${b.id}.jsonl`), 'utf8')
        .trim()
        .split('\n')
        .find((l) => l.includes('"kind":"end"'))!,
    )
    expect(end).toMatchObject({ end: 'failed', attempts: 2 })
  },
  600_000,
)

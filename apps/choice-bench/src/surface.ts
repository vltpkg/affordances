import * as lab from '@affordances/hosting-lab/trial'
import { canonicalJson, digest } from '@affordances/ir'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { loadavg } from 'node:os'
import path from 'node:path'
import type { Driver, DriverResult } from './drivers/types.ts'
import { parseAria, planAttributes, showsFact, showsInTree, structured } from './facts.ts'
import {
  CAPS,
  capHitsOf,
  DriverFailure,
  failureOf,
  faultPause,
  faultsOf,
  INSTRUCTIONS,
  priorFailures,
  readTrace,
  recordFault,
  scoredMetrics,
  setAside,
  type TrialSpec,
} from './harness.ts'
import { intendedEndState } from './intended.ts'
import {
  crossCheck,
  HarnessFault,
  projectKeyOf,
  readEndState,
  readServerErrors,
  startLabServer,
} from './lab-server.ts'
import { countedTokens, TOKENS_COUNTED, type EndReason } from './metrics.ts'
import { askedToConfirm, responseOf } from './response.ts'
import type { SurfaceServerConfig, SurfaceServerRecord } from './surface-server.ts'
import { purchaseMade, surfaceMetrics, type SurfaceFacts } from './surface-metrics.ts'
import { surfaces, type Surface } from './surfaces.ts'
import { TOOLS } from './tools.ts'
import { permutationFor, setupTrial } from './trial.ts'
import type { V0Config, V0Record } from './v0-server.ts'
import { consequential, type V0Trial } from './v0.ts'
import type { BrowserConfig, BrowserRecord } from './browser-server.ts'
import { browsingLoad, firstRequestAt, type BrowserTrial } from './browser.ts'
import type { McpConfig, McpRecord } from './mcp-server.ts'
import type { WebMcpConfig, WebMcpRecord } from './webmcp-server.ts'
import { declaresElicitation, mcpRequestEvent, mcpUnauthorized, type McpTrial } from './mcp.ts'

// one M7f surface trial (surfaces/PLAN.md §3, §5; the planner, 14:50Z): the trial's own fresh server, the surface's
// tools, the driver, and the outcome read the same way on every surface. The intended end state is replayed from the
// surface's own request events, the session's end state is the server's state file, and the two reads of that state
// are cross-checked. A disagreement or a harness stall is a harness fault: set aside, rerun, counted. M5's runTrial is
// left as it ran, so M5's records still reproduce at their commits

// the host name every trial's server is reached by, recorded in the trace (the planner, 14:40Z)
export const HOST = '127.0.0.1'

/** The surface's prompt: M5's paragraph, the instruction line naming its tools, the only text that differs, then T6. */
export const surfacePromptFor = (surface: Surface, task: lab.Task) =>
  `${INSTRUCTIONS}\n${surface.instruction}\n\nThe user: ${task.text}`

export type SurfaceOptions = {
  // the pinned export's built apps/hosting-lab, which every trial's server runs
  labBuild: string
  // the worker's port
  port: number
  // the attempt cap, MAX_ATTEMPTS unless a test sets another
  maxAttempts?: number
}

const SERVERS = {
  tools: path.resolve(import.meta.dirname, 'surface-server.ts'),
  v0: path.resolve(import.meta.dirname, 'v0-server.ts'),
  browser: path.resolve(import.meta.dirname, 'browser-server.ts'),
  mcp: path.resolve(import.meta.dirname, 'mcp-server.ts'),
  webmcp: path.resolve(import.meta.dirname, 'webmcp-server.ts'),
}
/** A surface's tool server, as a driver launches it: its script, beside its config file. */
export const toolServerOf = (surface: Surface) => SERVERS[surface.kind]

/** The config a surface's tool server takes, from what the runner (or the preflight) knows of the trial. */
export const toolServerConfig = (
  surface: Surface,
  t: {
    url: string
    session: string
    task: string
    index: number
    project: string
    stateFile: string
    out: string
  },
): SurfaceServerConfig | V0Config | BrowserConfig | McpConfig | WebMcpConfig =>
  surface.kind === 'mcp'
    ? { url: t.url, session: t.session, task: t.task, project: t.project, out: t.out }
    : surface.kind === 'v0' || surface.kind === 'browser' || surface.kind === 'webmcp'
      ? { url: t.url, session: t.session, out: t.out }
      : {
          surface: surface.id as 'full' | 'progressive',
          task: t.task,
          index: t.index,
          url: t.url,
          session: t.session,
          project: t.project,
          stateFile: t.stateFile,
          out: t.out,
        }
const V0_TOOLS = new Set(['affordances_open', 'affordances_call'])
const BROWSER_TOOLS = new Set(['open', 'snapshot', 'click', 'fill', 'submit'])

// what the runner reads from each surface's record, the same facts on every surface
const factsOf = async (
  surface: Surface,
  task: string,
  record: SurfaceServerRecord | V0Record | BrowserRecord | McpRecord | WebMcpRecord,
  endState: lab.EndState,
): Promise<Omit<SurfaceFacts, 'completed'>> => {
  const gb = (await planAttributes('pro')).bandwidthGb
  if (surface.kind === 'mcp' || surface.kind === 'webmcp') {
    const m = record as McpRecord | WebMcpRecord
    const first = m.calls.findIndex(mcpRequestEvent)
    const firstRequest = first < 0 ? undefined : first
    return {
      surface: surface.id,
      task,
      calls: m.calls.length,
      firstRequest,
      proAllowanceSeen: m.calls
        .slice(0, firstRequest)
        .some((c) => showsFact(c.output, 'pro', 'bandwidthGb', gb)),
      unauthorized: mcpUnauthorized(m),
      endState,
    }
  }
  if (surface.kind === 'browser') {
    const b = record as BrowserRecord
    const at = firstRequestAt(b)
    // a call's output came before the first request event when it returned before that review load
    const before = b.calls.filter((c) => at === undefined || c.at + c.ms <= at)
    const plans = await Promise.all(
      ['hobby', 'pro', 'business'].map(async (s) => String((await planAttributes(s)).name)),
    )
    const pro = String((await planAttributes('pro')).name)
    return {
      surface: surface.id,
      task,
      calls: b.calls.length,
      firstRequest: at === undefined ? undefined : before.length,
      // the value in the page's own format, '100 GB', matched as a whole phrase (design, 15:19Z)
      proAllowanceSeen: before.some((c) =>
        showsInTree(parseAria(c.output), pro, `${Number(gb).toLocaleString('en')} GB`, plans),
      ),
      // the browser reaches no API: a refusal is the page's, never 'unauthorized'
      unauthorized: false,
      endState,
    }
  }
  if (surface.kind === 'v0') {
    const calls = (record as V0Record).calls
    const first = calls.findIndex(consequential)
    const firstRequest = first < 0 ? undefined : first
    const before = calls.slice(0, firstRequest)
    const delta = (c: (typeof calls)[number]) =>
      c.output as { ok?: boolean; error?: { code?: string } }
    return {
      surface: surface.id,
      task,
      calls: calls.length,
      firstRequest,
      proAllowanceSeen: before.some((c) => showsFact(c.output, 'pro', 'bandwidthGb', gb)),
      unauthorized: calls.some((c) => delta(c)?.error?.code === 'unauthorized'),
      endState,
    }
  }
  const calls = (record as SurfaceServerRecord).calls
  const first = calls.findIndex((c) => c.tool === 'execute' && (askedToConfirm(c) || !!c.state))
  const firstRequest = first < 0 ? undefined : first
  return {
    surface: surface.id,
    task,
    calls: calls.length,
    firstRequest,
    proAllowanceSeen: calls
      .slice(0, firstRequest)
      .some((c) => showsFact(structured(c.response), 'pro', 'bandwidthGb', gb)),
    unauthorized: calls.some((c) => c.tool === 'execute' && responseOf(c)?.code === 'unauthorized'),
    endState,
  }
}

/**
 * The PLAN's budget (§4; the planner, 17:40Z): at most two attempts a spec, one retry, whatever the cause. One
 * constant, used by the runner, its spec loop and the entry
 */
export const MAX_ATTEMPTS = 2

/** A spec's attempts so far, from disk: its recorded harness faults and its CLI failures. */
const attemptsOf = (dir: string, id: string) =>
  faultsOf(dir).filter((f) => f.spec.id === id).length + priorFailures(dir, id)

// the Playwright the harness runs, for a record whose browser never launched
const playwrightVersion = () =>
  (createRequire(import.meta.url)('playwright/package.json') as { version: string }).version

// the record each surface's server writes before its first call (src/*-server.ts), for a trial whose server never
// started: no calls, and nothing launched
const emptyRecord = async (
  surface: Surface,
  t: {
    url: string
    spec: TrialSpec
    plans: readonly string[]
    project: string
    endState: lab.EndState
  },
): Promise<SurfaceServerRecord | V0Record | BrowserRecord | McpRecord | WebMcpRecord> => {
  const lists = { toolLists: [], calls: [] }
  if (surface.kind === 'v0') return { surface: 'v0', url: t.url, ...lists }
  if (surface.kind === 'mcp')
    return {
      surface: 'mcp',
      url: t.url,
      clientCapabilities: null,
      clientInfo: null,
      ...lists,
      elicitations: [],
    }
  if (surface.kind === 'browser')
    return {
      surface: 'browser',
      url: t.url,
      chromium: 'not launched',
      playwright: playwrightVersion(),
      launchArgs: [],
      ...lists,
      loads: [],
      confirms: [],
      aborted: [],
      stalls: [],
      errors: [],
    }
  if (surface.kind === 'webmcp')
    return {
      surface: 'webmcp',
      url: t.url,
      chromium: 'not launched',
      playwright: playwrightVersion(),
      launchArgs: [],
      ...lists,
      completions: [],
      aborted: [],
      errors: [],
    }
  const taskEdit = lab.TASK_EDITS[t.spec.task]
  return {
    surface: surface.id as SurfaceServerRecord['surface'],
    condition: surface.condition!.id as SurfaceServerRecord['condition'],
    task: t.spec.task,
    index: t.spec.index,
    plans: t.plans,
    project: t.project,
    manifestDigest: await digest(taskEdit ? taskEdit.apply(lab.manifest) : lab.manifest),
    baseDigest: await digest(lab.manifest),
    calls: [],
    exposures: [],
    approvals: [],
    capped: false,
    endState: t.endState,
  }
}

/**
 * A surface trial's metrics line, from what its trace keeps: the server's record, the cross-checked end state, the
 * replay records beside it, and the driver's counts. The run scores with it, and so does a re-score of a committed
 * trace (src/rescore.ts, intake's standing check), so the two can't drift.
 */
export const scoreSurfaceTrial = async (t: {
  surface: Surface
  task: string
  index: number
  record: SurfaceServerRecord | V0Record | BrowserRecord | McpRecord | WebMcpRecord
  endState: lab.EndState
  replayFile: string
  confirmFile: string
  tokens: number
  durationMs: number
  end: EndReason
}) => {
  const task = lab.tasks.find((x) => x.id === t.task)!
  const intended = await intendedEndState(t.replayFile)
  let browserMetrics: { browsingLoad: boolean; optimalConfirmLoad: boolean } | undefined
  if (t.surface.kind === 'browser') {
    const alternate = await intendedEndState(t.confirmFile)
    browserMetrics = {
      browsingLoad: browsingLoad(t.record as BrowserRecord),
      optimalConfirmLoad:
        !!alternate.state && lab.groundTruth(task).optimal.includes(lab.label(alternate.state)),
    }
  }
  // completed, from the store: the session's cross-checked end state against the trial's own start (purchaseMade)
  const start = await (await setupTrial(surfaces.full.condition!, t.index, t.task)).endState()
  const facts: SurfaceFacts = {
    ...(await factsOf(t.surface, t.task, t.record, t.endState)),
    completed: purchaseMade(start, t.endState),
  }
  return {
    ...surfaceMetrics(facts, intended, { tokens: t.tokens, durationMs: t.durationMs }, t.end),
    ...browserMetrics,
    ...(t.surface.kind === 'mcp' && {
      elicitationDeclared: declaresElicitation(t.record as McpRecord),
    }),
  }
}

export const runSurfaceTrial = async (
  spec: TrialSpec,
  driver: Driver,
  dir: string,
  options: SurfaceOptions,
) => {
  if (!spec.surface) throw new Error(`trial ${spec.id} names no surface`)
  const surface = surfaces[spec.surface]
  const task = lab.tasks.find((t) => t.id === spec.task)
  if (!task) throw new Error(`no task ${spec.task}`)
  mkdirSync(dir, { recursive: true })
  setAside(dir, spec.id)
  const file = (suffix: string) => path.join(dir, `${spec.id}.${suffix}`)
  const session = `s_${spec.id}`.replaceAll(/[^\w-]/g, '_').slice(0, 64)
  const plans = permutationFor(spec.index)
  const stateFile = file('state.json')
  const serverLog = file('server.log')
  const server = await startLabServer({
    dir: options.labBuild,
    port: options.port,
    plans,
    session,
    task: spec.task,
    stateFile,
    stderr: serverLog,
  })
  const url = `http://${HOST}:${options.port}`
  // the trial's project key, as its session sees it, before the agent's first call: the four tools' server needs it
  // (a progressive first view without a start doesn't show the project), and the replay's offer ids carry it
  const project = await projectKeyOf(server.url, session).catch(async (e) => {
    await server.stop()
    throw e
  })
  const out = file('server.json')
  const configPath = file('config.json')
  const config = toolServerConfig(surface, {
    url,
    session,
    task: spec.task,
    index: spec.index,
    project,
    stateFile,
    out,
  })
  writeFileSync(configPath, JSON.stringify(config))
  const prompt = surfacePromptFor(surface, task)
  const startedAt = new Date().toISOString()
  const loadAtStart = loadavg()
  let result: DriverResult | undefined
  let thrown: string | undefined
  try {
    result = await driver.run({
      model: spec.model,
      prompt,
      mcp: { command: process.execPath, args: [SERVERS[surface.kind], configPath] },
      timeoutMs: CAPS.ms,
      maxTurns: CAPS.turns,
    })
  } catch (e) {
    thrown = e instanceof Error ? e.message : String(e)
  }
  // the outcome's two reads, before the server stops: the state file, and project.read through the session
  let fault: { kind: string; detail: string } | undefined
  let endState: lab.EndState | undefined
  try {
    const state = readEndState(stateFile, session)
    await crossCheck(server.url, session, state)
    endState = state as lab.EndState
  } catch (e) {
    if (!(e instanceof HarnessFault)) throw e
    fault = { kind: e.kind, detail: e.detail }
  } finally {
    await server.stop()
  }
  const failed = failureOf(
    result,
    thrown ?? (existsSync(out) ? undefined : 'the tool server never started'),
  )
  // two classes, kept apart (the planner, 15:03Z). A CLI driver's failure is intake's 12:05Z rule, as in M5: auth stops
  // the run; a crash or a 529 is set aside and rerun once, and a second is scored 'failed'. A harness fault is the
  // PLAN's (§5): the app answered a 5xx, counted exactly in the state file, or the outcome's two reads disagreed. It's
  // set aside, rerun and counted, never scored, and it's checked before the CLI's rule, since a trial the app failed
  // is the harness's whatever the CLI did. The server's stderr is kept as evidence, and never classed by
  const writeFailure = () =>
    writeFileSync(
      file('failure.json'),
      JSON.stringify({
        ...failed,
        at: new Date().toISOString(),
        exitCode: result?.exitCode ?? null,
      }),
    )
  const sendFailure = () => {
    writeFailure()
    setAside(dir, spec.id)
    throw new DriverFailure(spec.id, failed!.kind, failed!.detail)
  }
  if (failed?.kind === 'auth') sendFailure()
  const answered5xx = readServerErrors(stateFile)
  fault ??= answered5xx.length
    ? {
        kind: 'stall',
        detail: `the app answered ${answered5xx.map((e) => `${e.status} on ${e.route}`).join(', ')}`,
      }
    : undefined
  // the browser's two stalls (§5): the browser itself failed, or a ref from the immediately preceding snapshot didn't
  // resolve. A ref the agent invented is its own mistake, told to it, and no stall
  const browserRecord =
    surface.kind === 'browser' && existsSync(out)
      ? (JSON.parse(readFileSync(out, 'utf8')) as BrowserRecord)
      : undefined
  const webmcpRecord =
    surface.kind === 'webmcp' && existsSync(out)
      ? (JSON.parse(readFileSync(out, 'utf8')) as WebMcpRecord)
      : undefined
  fault ??= webmcpRecord?.errors.length
    ? {
        kind: 'stall',
        detail: `the page's tools failed: ${webmcpRecord.errors.map((e) => e.detail).join('; ')}`,
      }
    : undefined
  fault ??= browserRecord?.errors.length
    ? {
        kind: 'stall',
        detail: `the browser failed: ${browserRecord.errors.map((e) => e.detail).join('; ')}`,
      }
    : browserRecord?.stalls.length
      ? {
          kind: 'stall',
          detail: `a ref from the preceding snapshot didn't resolve: ${browserRecord.stalls.map((s) => `${s.tool} ${s.ref}`).join(', ')}`,
        }
      : undefined
  if (fault) {
    // the attempt is kept whole, beside its reason: setAside moves its record, state file, server log and raw output
    // into interrupted/, never deleting them (M5's rule)
    recordFault(dir, spec, {
      ...fault,
      serverErrors: answered5xx,
      serverLog: `${spec.id}.server.log`,
      raw: result?.raw ?? null,
      attempt: faultsOf(dir).filter((f) => f.spec.id === spec.id).length + 1,
    })
    return { spec, fault }
  }
  // this attempt's number, faults and failures before it counted: a CLI failure on the final attempt is scored failed
  // (intake's 12:05Z rule, ITT), and on an earlier one it's set aside for its retry (the planner, 17:40Z)
  const attempts = attemptsOf(dir, spec.id) + 1
  if (failed && attempts < (options.maxAttempts ?? MAX_ATTEMPTS)) sendFailure()
  // a CLI that failed on the final attempt before its tool server wrote a record (code review of M8, #4): scored
  // 'failed' under the crash rule like any other final-attempt failure, from the record a server writes before its
  // first call, with its failure.json beside it, and the run goes on. Without a failure, a missing record is the
  // harness's to explain
  if (!existsSync(out) && !failed)
    throw new Error(`trial ${spec.id}: the tool server never started (${thrown ?? 'no error'})`)
  if (!existsSync(out)) writeFailure()
  const record = existsSync(out)
    ? (JSON.parse(readFileSync(out, 'utf8')) as
        | SurfaceServerRecord
        | V0Record
        | BrowserRecord
        | McpRecord
        | WebMcpRecord)
    : await emptyRecord(surface, { url, spec, plans, project, endState: endState! })
  // the replay's record: the surface's, with what a fresh store needs
  const replayFile = file('replay.json')
  writeFileSync(
    replayFile,
    JSON.stringify(
      surface.kind === 'v0'
        ? ({
            ...(record as V0Record),
            condition: 'A',
            index: spec.index,
            task: spec.task,
            project,
          } satisfies V0Trial)
        : surface.kind === 'mcp' || surface.kind === 'webmcp'
          ? ({
              ...(record as McpRecord | WebMcpRecord),
              condition: 'A',
              index: spec.index,
              task: spec.task,
              project,
            } as McpTrial)
          : surface.kind === 'browser'
            ? ({
                ...(record as BrowserRecord),
                condition: 'A',
                index: spec.index,
                task: spec.task,
                project,
                rule: 'first-load',
              } satisfies BrowserTrial)
            : record,
    ),
  )
  // the browser's alternate request event (§5), for the pilot's browsing rule: the confirm click with the review-page
  // load just before it, replayed the same way
  const confirmFile = file('replay-confirm.json')
  if (surface.kind === 'browser')
    writeFileSync(
      confirmFile,
      JSON.stringify({
        ...(record as BrowserRecord),
        condition: 'A',
        index: spec.index,
        task: spec.task,
        project,
        rule: 'confirm-load',
      } satisfies BrowserTrial),
    )
  const usage = result?.usage ?? { inputTokens: 0, outputTokens: 0 }
  const tokens = countedTokens(usage)
  const capHits = capHitsOf({
    capped: surface.kind === 'tools' && (record as SurfaceServerRecord).capped,
    tokens,
    durationMs: result?.durationMs ?? 0,
    stopped: result?.stopped,
  })
  const end: EndReason = failed ? 'failed' : capHits.length ? 'capped' : 'final'
  const metrics = await scoreSurfaceTrial({
    surface,
    task: spec.task,
    index: spec.index,
    record,
    endState: endState!,
    replayFile,
    confirmFile,
    tokens,
    durationMs: result?.durationMs ?? 0,
    end,
  })
  // the driver's record of its calls against the server's: a mismatch marks the trial, as in M5
  const known =
    surface.kind === 'v0'
      ? V0_TOOLS
      : surface.kind === 'browser'
        ? BROWSER_TOOLS
        : new Set(Object.keys(TOOLS))
  const names = (result?.trace ?? []).map((t) => t.name.replace(/^mcp__bench__/, ''))
  const driverCalls = names.filter((n) => known.has(n))
  const otherTools = names.filter((n) => !known.has(n))
  const traceMismatch =
    canonicalJson(driverCalls) !== canonicalJson(record.calls.map((c) => c.tool))
  const taskEdit = lab.TASK_EDITS[spec.task]
  const lines = [
    {
      kind: 'trial',
      ...spec,
      surface: surface.id,
      cli: result?.cli ?? null,
      model: { requested: spec.model, resolved: result?.resolvedModel ?? null },
      caps: { ...CAPS, tokensCount: TOKENS_COUNTED },
      plans,
      startedAt,
      server: {
        url,
        buildId: server.buildId,
        startMs: server.startMs,
        env: server.env,
      },
      fixture: {
        manifestDigest: await digest(taskEdit ? taskEdit.apply(lab.manifest) : lab.manifest),
        baseDigest: await digest(lab.manifest),
      },
      prompt,
      instruction: surface.instruction,
      // the browser's, the same across trials (the preflight checks it): Chromium's and Playwright's versions, and its
      // flags, none beyond Playwright's, so no WebMCP; and any request to another origin, aborted
      // the WebMCP bridge's browser, the same across trials, and the simulated person's completions on the review page
      ...(surface.kind === 'webmcp' && {
        webmcp: {
          chromium: (record as WebMcpRecord).chromium,
          playwright: (record as WebMcpRecord).playwright,
          launchArgs: (record as WebMcpRecord).launchArgs,
          completions: (record as WebMcpRecord).completions,
          aborted: (record as WebMcpRecord).aborted,
        },
      }),
      // the MCP pilot's finding (the planner, 15:55Z): whether the client declared elicitation, and what it was asked
      ...(surface.kind === 'mcp' && {
        mcp: {
          declaresElicitation: declaresElicitation(record as McpRecord),
          clientCapabilities: (record as McpRecord).clientCapabilities,
          clientInfo: (record as McpRecord).clientInfo,
          elicitations: (record as McpRecord).elicitations,
        },
      }),
      ...(surface.kind === 'browser' && {
        browser: {
          chromium: (record as BrowserRecord).chromium,
          playwright: (record as BrowserRecord).playwright,
          launchArgs: (record as BrowserRecord).launchArgs,
          aborted: (record as BrowserRecord).aborted,
        },
      }),
    },
    ...record.calls.map((c) => ({ kind: 'call', ...c })),
    {
      kind: 'end',
      end,
      capHits,
      ...(failed && { driverFailure: failed, attempts }),
      traceMismatch,
      otherTools,
      ...(result?.notes?.length && { driverNotes: result.notes }),
      spawned: otherTools.some((n) => /spawn/i.test(n)),
      finalText: result?.finalText ?? '',
      usage,
      totalTokens: tokens,
      durationMs: result?.durationMs ?? 0,
      turns: result?.turns ?? null,
      footprint: result?.footprint ?? null,
      load: { start: loadAtStart, end: loadavg() },
      // the server's stderr, kept as evidence and never classed by
      serverLog: existsSync(serverLog) ? readFileSync(serverLog, 'utf8') : '',
      endState,
      raw: result?.raw ?? null,
    },
    { kind: 'metrics', ...metrics },
  ]
  writeFileSync(file('jsonl'), `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`)
  return { spec, end, capHits, metrics }
}

// a trace that's complete: its trial, end and metrics lines all there. Read back, never run again (intake)
const scored = (dir: string, id: string) =>
  scoredMetrics(readTrace(path.join(dir, `${id}.jsonl`))) !== undefined

/** A run that must stop: past the fault threshold (intake, 14:24Z), or on an auth failure. */
export class SurfaceRunStopped extends Error {}

/**
 * A surface run's specs, each until it's scored or out of attempts, from one ordered queue, a worker per port. At most
 * MAX_ATTEMPTS attempts a spec, whatever the cause, counted from disk so a resume counts the same; the final attempt's
 * class decides (runSurfaceTrial): a CLI crash or 529 on it is scored failed, and a harness fault on it leaves the
 * spec missing, never imputed. Auth stops the run, and so does the fault pause: past 2% of the trials run, or 2 in the
 * pilot (intake, 14:24Z).
 */
export const runSurfaceSpecs = async (
  specs: TrialSpec[],
  driverFor: (spec: TrialSpec) => Driver,
  dir: string,
  options: SurfaceOptions & {
    pilot: boolean
    // workers: one per port, taking the next spec from the one ordered queue (M5's concurrency 2)
    ports?: number[]
  },
) => {
  const missing: string[] = []
  const trialsRun = () => specs.filter((s) => scored(dir, s.id)).length + faultsOf(dir).length
  const cap = options.maxAttempts ?? MAX_ATTEMPTS
  const queue = specs.filter((s) => !scored(dir, s.id))
  let stopped: Error | undefined
  const runOne = async (s: TrialSpec, port: number) => {
    for (;;) {
      if (stopped) return
      if (attemptsOf(dir, s.id) >= cap) {
        missing.push(s.id)
        return
      }
      let r: Awaited<ReturnType<typeof runSurfaceTrial>>
      try {
        r = await runSurfaceTrial(s, driverFor(s), dir, { ...options, port })
      } catch (e) {
        if (e instanceof DriverFailure && e.kind === 'auth')
          throw new SurfaceRunStopped(`an auth failure in ${s.id}: re-login is the human's`)
        // a crash or 529 before the final attempt, set aside for its retry
        if (e instanceof DriverFailure) continue
        throw e
      }
      if (!('fault' in r)) return
      const paused = faultPause(dir, trialsRun(), options.pilot)
      if (paused) throw new SurfaceRunStopped(paused)
    }
  }
  const ports = options.ports ?? [options.port]
  await Promise.all(
    ports.map(async (port) => {
      for (let s = queue.shift(); s && !stopped; s = queue.shift())
        try {
          await runOne(s, port)
        } catch (e) {
          // a pause or an auth failure stops every worker before its next spec
          stopped ??= e as Error
        }
    }),
  )
  if (stopped) throw stopped
  return { missing, faults: faultsOf(dir).length, trialsRun: trialsRun() }
}

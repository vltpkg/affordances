import * as lab from '@affordances/hosting-lab/trial'
import { canonicalJson, digest } from '@affordances/ir'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { loadavg } from 'node:os'
import path from 'node:path'
import type { Driver, DriverResult } from './drivers/types.ts'
import { parseAria, planAttributes, showsFact, showsInTree, structured } from './facts.ts'
import {
  CAPS,
  DriverFailure,
  failureOf,
  faultPause,
  faultsOf,
  INSTRUCTIONS,
  priorFailures,
  recordFault,
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
import type { EndReason } from './metrics.ts'
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
}

const SERVERS = {
  tools: path.resolve(import.meta.dirname, 'surface-server.ts'),
  v0: path.resolve(import.meta.dirname, 'v0-server.ts'),
  browser: path.resolve(import.meta.dirname, 'browser-server.ts'),
  mcp: path.resolve(import.meta.dirname, 'mcp-server.ts'),
  webmcp: path.resolve(import.meta.dirname, 'webmcp-server.ts'),
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
  const config: SurfaceServerConfig | V0Config | BrowserConfig | McpConfig | WebMcpConfig =
    surface.kind === 'mcp'
      ? { url, session, task: spec.task, out }
      : surface.kind === 'v0' || surface.kind === 'browser' || surface.kind === 'webmcp'
        ? { url, session, out }
        : {
            surface: surface.id as 'full' | 'progressive',
            task: spec.task,
            index: spec.index,
            url,
            session,
            project,
            stateFile,
            out,
          }
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
  const sendFailure = () => {
    writeFileSync(
      file('failure.json'),
      JSON.stringify({
        ...failed,
        at: new Date().toISOString(),
        exitCode: result?.exitCode ?? null,
      }),
    )
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
  const attempts = priorFailures(dir, spec.id) + 1
  if (failed && attempts === 1) sendFailure()
  if (!existsSync(out))
    throw new Error(`trial ${spec.id}: the tool server never started (${thrown ?? 'no error'})`)
  const record = JSON.parse(readFileSync(out, 'utf8')) as
    | SurfaceServerRecord
    | V0Record
    | BrowserRecord
    | McpRecord
    | WebMcpRecord
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
  const intended = await intendedEndState(replayFile)
  // the browser's alternate request event (§5), for the pilot's browsing rule: the confirm click with the review-page
  // load just before it, replayed the same way
  let browserMetrics: { browsingLoad: boolean; optimalConfirmLoad: boolean } | undefined
  if (surface.kind === 'browser') {
    const b = record as BrowserRecord
    const confirmFile = file('replay-confirm.json')
    const confirmTrial: BrowserTrial = {
      ...b,
      condition: 'A',
      index: spec.index,
      task: spec.task,
      project,
      rule: 'confirm-load',
    }
    writeFileSync(confirmFile, JSON.stringify(confirmTrial))
    const alternate = await intendedEndState(confirmFile)
    browserMetrics = {
      browsingLoad: browsingLoad(b),
      optimalConfirmLoad:
        !!alternate.state && lab.groundTruth(task).optimal.includes(lab.label(alternate.state)),
    }
  }
  const usage = result?.usage ?? { inputTokens: 0, outputTokens: 0 }
  // M5's count: input plus output, with cache writes as input and cache reads excluded
  const tokens = usage.inputTokens + usage.outputTokens + (usage.cacheWriteTokens ?? 0)
  const capped = surface.kind === 'tools' && (record as SurfaceServerRecord).capped
  const capHits = [
    capped && 'calls',
    tokens > CAPS.tokens && 'tokens',
    (result?.durationMs ?? 0) >= CAPS.ms && 'time',
    result?.stopped === 'turns' && 'turns',
  ].filter((x): x is string => typeof x === 'string')
  const end: EndReason = failed ? 'failed' : capHits.length ? 'capped' : 'final'
  // completed, from the store: the session's cross-checked end state against the trial's own start (purchaseMade)
  const start = await (await setupTrial(surfaces.full.condition!, spec.index, spec.task)).endState()
  const facts: SurfaceFacts = {
    ...(await factsOf(surface, spec.task, record, endState!)),
    completed: purchaseMade(start, endState!),
  }
  const metrics = {
    ...surfaceMetrics(facts, intended, { tokens, durationMs: result?.durationMs ?? 0 }, end),
    ...browserMetrics,
    ...(surface.kind === 'mcp' && {
      elicitationDeclared: declaresElicitation(record as McpRecord),
    }),
  }
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
      caps: { ...CAPS, tokensCount: 'input + output + cache writes; cache reads excluded' },
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
const scored = (dir: string, id: string) => {
  const file = path.join(dir, `${id}.jsonl`)
  if (!existsSync(file)) return false
  try {
    const kinds = new Set(
      readFileSync(file, 'utf8')
        .trim()
        .split('\n')
        .map((l) => (JSON.parse(l) as { kind: string }).kind),
    )
    return kinds.has('trial') && kinds.has('end') && kinds.has('metrics')
  } catch {
    return false
  }
}

/** A run that must stop: past the fault threshold (intake, 14:24Z), or on an auth failure. */
export class SurfaceRunStopped extends Error {}

/**
 * A surface run's specs, one at a time on the worker's port. A harness fault is rerun at once, and counted; the run
 * pauses past 2% of the trials run, or 2 in the pilot, counting what's on disk so a resume counts the same. A CLI
 * driver's crash or 529 is rerun once, then scored failed, and auth stops the run (intake, 12:05Z). A spec still
 * without a scored trace after maxFaults faulted attempts is reported missing, never imputed.
 */
export const runSurfaceSpecs = async (
  specs: TrialSpec[],
  driverFor: (spec: TrialSpec) => Driver,
  dir: string,
  options: SurfaceOptions & { pilot: boolean; maxFaults?: number },
) => {
  const missing: string[] = []
  const trialsRun = () => specs.filter((s) => scored(dir, s.id)).length + faultsOf(dir).length
  for (const s of specs) {
    if (scored(dir, s.id)) continue
    let faults = 0
    let crashes = 0
    for (;;) {
      let r: Awaited<ReturnType<typeof runSurfaceTrial>>
      try {
        r = await runSurfaceTrial(s, driverFor(s), dir, options)
      } catch (e) {
        if (e instanceof DriverFailure && e.kind !== 'auth' && crashes++ === 0) continue
        if (e instanceof DriverFailure && e.kind === 'auth')
          throw new SurfaceRunStopped(`an auth failure in ${s.id}: re-login is the human's`)
        throw e
      }
      if (!('fault' in r)) break
      const paused = faultPause(dir, trialsRun(), options.pilot)
      if (paused) throw new SurfaceRunStopped(paused)
      if (++faults >= (options.maxFaults ?? 3)) {
        missing.push(s.id)
        break
      }
    }
  }
  return { missing, faults: faultsOf(dir).length, trialsRun: trialsRun() }
}

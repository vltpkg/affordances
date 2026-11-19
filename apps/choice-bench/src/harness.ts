import * as lab from '@affordances/hosting-lab/trial'
import { canonicalJson } from '@affordances/ir'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { loadavg } from 'node:os'
import path from 'node:path'
import { conditions, type ConditionId } from './conditions.ts'
import type { SurfaceId } from './surfaces.ts'
import type { Driver, DriverResult } from './drivers/types.ts'
import { intendedEndState } from './intended.ts'
import { computeMetrics, countedTokens, TOKENS_COUNTED, type EndReason } from './metrics.ts'
import type { ServerConfig, ServerRecord } from './server.ts'
import { MAX_CALLS, TOOLS } from './tools.ts'

// RFC 0003 §5 and §9: one trial through one driver, capped, traced, and scored against the task's ground truth

// §5.3: the same paragraph for every trial, then the task's text
export const INSTRUCTIONS =
  'You act for the user below. Use the tools to find options, and request what the user needs. When an action needs the user’s approval, request it; the user answers.'
export const promptFor = (task: lab.Task) => `${INSTRUCTIONS}\n\nThe user: ${task.text}`

// §5.2's caps; the tool-call cap is the server's
export const CAPS = { calls: MAX_CALLS, turns: 40, tokens: 150_000, ms: 10 * 60_000 }

/** The caps a trial hit, in the trace's order. A turn cap is only the CLI's own signal: a crash, a 529 or an auth failure
 * also exits nonzero with no final text, and isn't one. The turn cap is the main runaway guard */
export const capHitsOf = (t: {
  capped: boolean
  tokens: number
  durationMs: number
  stopped?: DriverResult['stopped']
}) =>
  [
    t.capped && 'calls',
    t.tokens > CAPS.tokens && 'tokens',
    t.durationMs >= CAPS.ms && 'time',
    t.stopped === 'turns' && 'turns',
  ].filter((x): x is string => typeof x === 'string')

export type TrialSpec = {
  id: string
  condition: ConditionId
  // M7f's surface, for a surface trial (src/surfaces.ts)
  surface?: SurfaceId
  task: string
  model: string
  driver: string
  index: number // within its cell: the plan-id order and the fake driver's seed
}

const SERVER = path.resolve(import.meta.dirname, 'server.ts')

// a trial's files, as a run leaves them
const TRIAL_FILES = [
  '.server.json',
  '.server.json.tmp',
  '.config.json',
  '.raw.json',
  '.jsonl',
  '.failure.json',
  '.fault.json',
  // a surface trial's (src/surface.ts): its server's state file and stderr, and the replay's record
  '.state.json',
  '.server.log',
  '.replay.json',
  // a browser trial's confirm-load replay (code review of M8)
  '.replay-confirm.json',
]
// what an earlier, unfinished attempt left of a trial: moved into interrupted/, never deleted (intake), so a rerun is
// scored only from its own record (review of 4893655c: a stale server record would have passed the started check)
export const setAside = (dir: string, id: string) => {
  const stale = TRIAL_FILES.filter((e) => existsSync(path.join(dir, `${id}${e}`)))
  if (!stale.length) return
  const to = path.join(dir, 'interrupted', `${id}-${new Date().toISOString().replaceAll(':', '')}`)
  mkdirSync(to, { recursive: true })
  for (const e of stale) renameSync(path.join(dir, `${id}${e}`), path.join(to, `${id}${e}`))
}

// boundary review #8, intake's ruling (2026-11-18 12:05Z): a nonzero exit with no cap signal is a driver failure, one
// of three kinds, read from the CLI's own error text. A crash or a 529 is set aside in interrupted/ and rerun once by
// the resume; a second failure is scored 'failed'. An auth failure is never retried: it stops the whole run
export type FailureKind = 'auth' | 'overloaded' | 'crash'
const AUTH =
  /\b401\b|authenticat|unauthori[sz]ed|invalid (api |x-api-)?key|\/login|not logged in|log in again|oauth token/i
const OVERLOADED = /\b529\b|overloaded/i
export const failureOf = (
  result: DriverResult | undefined,
  thrown?: string,
): { kind: FailureKind; detail: string } | undefined => {
  // an exit 0, the timeout's 124 (the time cap) and the CLI's own turn-limit signal are no driver failure
  if (!thrown && result && (result.exitCode === 0 || result.exitCode === 124 || result.stopped))
    return
  // classed by the CLI's structured error alone: stderr and a thrown message can echo tool output, so they only ever
  // make a crash (review of 006e2902)
  const structured = result?.error ?? ''
  const detail = (
    [thrown, result?.error, result?.stderr].filter(Boolean).join('\n') || `exit ${result?.exitCode}`
  ).slice(0, 2000)
  return {
    kind: AUTH.test(structured) ? 'auth' : OVERLOADED.test(structured) ? 'overloaded' : 'crash',
    detail,
  }
}
export class DriverFailure extends Error {
  // plain fields: node runs this file by stripping types, which parameter properties aren't
  readonly spec: string
  readonly kind: FailureKind
  readonly detail: string
  constructor(spec: string, kind: FailureKind, detail: string) {
    super(`${spec}: a driver failure (${kind}): ${detail.split('\n')[0]}`)
    this.spec = spec
    this.kind = kind
    this.detail = detail
  }
}
// how many earlier attempts of a trial failed: each left its failure record in interrupted/
export const priorFailures = (dir: string, id: string) => {
  const root = path.join(dir, 'interrupted')
  if (!existsSync(root)) return 0
  return readdirSync(root).filter((d) => existsSync(path.join(root, d, `${id}.failure.json`)))
    .length
}
// RFC 0003's pause, as the confirmatory PLAN states it: more than 5% of specs failed and not yet complete, and a resume
// doesn't start; intake is told first
export const pauseFor = (dir: string, specs: TrialSpec[]): string | undefined => {
  const pending = specs.filter(
    (s) => !existsSync(path.join(dir, `${s.id}.jsonl`)) && priorFailures(dir, s.id) > 0,
  )
  const limit = Math.floor(specs.length * 0.05)
  if (pending.length > limit)
    return `${pending.length} specs failed and await their rerun, more than 5% (${limit}): tell intake before resuming`
}

// the logins a plan needs: one per CLI its specs run, never one it doesn't (boundary review #9). Both are still read
// and recorded; only the needed ones gate the run
const LOGIN_OF: Record<string, 'claude' | 'codex'> = {
  'claude-cli': 'claude',
  'codex-cli': 'codex',
}
export const missingLogins = (
  logins: { claude: boolean; codex: boolean },
  specs: TrialSpec[],
): ('claude' | 'codex')[] =>
  [...new Set(specs.flatMap((s) => (LOGIN_OF[s.driver] ? [LOGIN_OF[s.driver]!] : [])))]
    .toSorted()
    .filter((l) => !logins[l])

// harness faults (intake, 2026-11-18 14:24Z): a cross-check disagreement or a harness stall (surfaces/PLAN.md §5) is
// the harness's, not the agent's. The trial is set aside, never scored, and rerun by the resume; each is counted, and
// reported per cell; and the run pauses, with intake told, past 2% of the trials run, or 2 in the pilot
export const recordFault = (
  dir: string,
  spec: TrialSpec,
  fault: { kind: string; detail: string; [evidence: string]: unknown },
) => {
  writeFileSync(
    path.join(dir, `${spec.id}.fault.json`),
    JSON.stringify({ ...fault, spec, at: new Date().toISOString() }),
  )
  setAside(dir, spec.id)
}
// every fault recorded, by trial and cell (condition or surface, task and model)
export const faultsOf = (dir: string) => {
  const root = path.join(dir, 'interrupted')
  if (!existsSync(root)) return []
  return readdirSync(root).flatMap((d) =>
    readdirSync(path.join(root, d))
      .filter((f) => f.endsWith('.fault.json'))
      .map(
        (f) =>
          JSON.parse(readFileSync(path.join(root, d, f), 'utf8')) as {
            kind: string
            detail: string
            spec: TrialSpec
          },
      ),
  )
}
export const faultsByCell = (dir: string) => {
  const out: Record<string, number> = {}
  for (const f of faultsOf(dir)) {
    const cell = `${f.spec.surface ?? f.spec.condition} ${f.spec.task} ${f.spec.model}`
    out[cell] = (out[cell] ?? 0) + 1
  }
  return out
}
// whether the run must pause: more than 2% of the trials run were faults, or more than 2 in the pilot
export const faultPause = (dir: string, run: number, pilot: boolean): string | undefined => {
  const faults = faultsOf(dir).length
  const limit = pilot ? 2 : Math.floor(run * 0.02)
  if (faults > limit)
    return `${faults} harness faults in ${run} trials run, more than ${pilot ? 'the pilot’s 2' : `2% (${limit})`}: the run pauses, and intake is told`
}

// codex's default: the first listed model in its cache, as codex exec with no -m takes it
const codexDefault = () => {
  try {
    const cache = JSON.parse(
      readFileSync(path.join(process.env.HOME ?? '', '.codex/models_cache.json'), 'utf8'),
    ) as { models: { slug: string; priority: number; visibility: string }[] }
    return (
      cache.models
        .filter((m) => m.visibility === 'list')
        .toSorted((a, b) => a.priority - b.priority)[0]?.slug ?? null
    )
  } catch {
    return null
  }
}

// a trace's lines (src/harness.ts and src/surface.ts write them), each parsed once. Its metrics line, the outcome, stays
// text until a scorer asks for it, so a liveness check that only reads the rest reads no outcome (src/status.ts)
type Line = Record<string, any>
const METRICS_PREFIX = '{"kind":"metrics"'
export type Trace = { trial?: Line; end?: Line; calls: number; metrics?: string; broken: boolean }

/** One trace, read once: none when there's no file, and `broken` when a line didn't parse, as a cut-off write leaves. */
export const readTrace = (file: string): Trace | undefined => {
  if (!existsSync(file)) return
  const t: Trace = { calls: 0, broken: false }
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue
    if (line.startsWith(METRICS_PREFIX)) {
      t.metrics = line
      continue
    }
    let l: Line
    try {
      l = JSON.parse(line) as Line
    } catch {
      t.broken = true
      continue
    }
    if (l.kind === 'trial') t.trial = l
    else if (l.kind === 'end') t.end = l
    else if (l.kind === 'call') t.calls++
  }
  return t
}

/** A scored trace's metrics, parsed: its trial, end and metrics lines all whole. Otherwise none, so the trial runs. */
export const scoredMetrics = (t: Trace | undefined): Line | undefined => {
  if (!t || t.broken || !t.trial || !t.end || !t.metrics) return
  try {
    const { kind: _, ...metrics } = JSON.parse(t.metrics) as Line
    return metrics
  } catch {
    return
  }
}

/** A trial's result from its trace's lines: the run returns the same as a resume reads back. */
export const resultOf = (spec: TrialSpec, trial: Line, end: Line, metrics: Line) => {
  const footprint = end.footprint ?? null
  return {
    spec,
    end: end.end as EndReason,
    capHits: end.capHits as string[],
    traceMismatch: end.traceMismatch as boolean,
    spawned: end.spawned as boolean,
    metrics: metrics as ReturnType<typeof computeMetrics>,
    turns: end.turns as number | null,
    footprint,
    flagged: (footprint?.claude?.length ?? 0) > 0,
    load: end.load.start[0] as number,
    cli: trial.cli as DriverResult['cli'] | null,
    resolvedModel: trial.model.resolved as string | null,
  }
}

export const runTrial = async (spec: TrialSpec, driver: Driver, dir: string) => {
  mkdirSync(dir, { recursive: true })
  setAside(dir, spec.id)
  const task = lab.tasks.find((t) => t.id === spec.task)
  if (!task) throw new Error(`no task ${spec.task}`)
  const out = path.join(dir, `${spec.id}.server.json`)
  const config: ServerConfig = {
    condition: spec.condition,
    task: spec.task,
    index: spec.index,
    out,
  }
  const configPath = path.join(dir, `${spec.id}.config.json`)
  writeFileSync(configPath, JSON.stringify(config))
  const prompt = promptFor(task)
  const startedAt = new Date().toISOString()
  // the host's load, every user's, beside the trial's latency (intake's runbook)
  const loadAtStart = loadavg()
  let result: DriverResult | undefined
  let failure: string | undefined
  try {
    result = await driver.run({
      model: spec.model,
      prompt,
      mcp: { command: process.execPath, args: [SERVER, configPath] },
      timeoutMs: CAPS.ms,
      maxTurns: CAPS.turns,
    })
  } catch (e) {
    failure = e instanceof Error ? e.message : String(e)
  }
  // a driver failure: the first crash or 529 is recorded, set aside in interrupted/ and thrown, so the resume reruns
  // the spec once; an auth failure always is, and stops the run. A second crash or 529 is scored 'failed'
  const failed = failureOf(
    result,
    failure ?? (existsSync(out) ? undefined : `the tool server never started (no error)`),
  )
  if (failed && (failed.kind === 'auth' || priorFailures(dir, spec.id) === 0)) {
    recordFailure(dir, spec.id, failed, result, { raw: result?.raw ?? null })
    setAside(dir, spec.id)
    throw new DriverFailure(spec.id, failed.kind, failed.detail)
  }
  if (!existsSync(out))
    throw new Error(`trial ${spec.id}: the tool server never started (${failure ?? 'no error'})`)
  const record = JSON.parse(readFileSync(out, 'utf8')) as ServerRecord
  const usage = result?.usage ?? { inputTokens: 0, outputTokens: 0 }
  const tokens = countedTokens(usage)
  const capHits = capHitsOf({
    capped: record.capped,
    tokens,
    durationMs: result?.durationMs ?? 0,
    stopped: result?.stopped,
  })
  const end: EndReason = record.aborted
    ? 'aborted'
    : failed
      ? 'failed'
      : capHits.length
        ? 'capped'
        : 'final'
  // the driver's record of its benchmark calls against the server's: a mismatch marks the trial (§5.1). Any other
  // tool the CLI called is recorded apart, and a sub-agent spawn marks the trial (§8)
  const { otherTools, spawned, traceMismatch } = traceCheck(
    result,
    new Set(Object.keys(TOOLS)),
    record.calls,
  )
  const intended = await intendedEndState(out)
  const metrics = computeMetrics(record, result ?? { usage, durationMs: 0 }, end, intended)
  const policy = conditions[spec.condition].policy
  const lines = [
    {
      kind: 'trial',
      ...spec,
      cli: result?.cli ?? null,
      // what the CLI ran: claude names it at init; codex runs exactly its -m id, beside what its default would be
      model: {
        requested: spec.model,
        resolved: result?.resolvedModel ?? (spec.driver === 'codex-cli' ? spec.model : null),
        ...(spec.driver === 'codex-cli' && { cliDefault: codexDefault() }),
      },
      caps: { ...CAPS, tokensCount: TOKENS_COUNTED },
      plans: record.plans,
      startedAt,
      fixture: { manifestDigest: record.manifestDigest, baseDigest: record.baseDigest, policy },
      prompt,
    },
    ...record.calls.map((c) => ({ kind: 'call', ...c })),
    { kind: 'exposures', exposures: record.exposures },
    { kind: 'approvals', approvals: record.approvals },
    {
      kind: 'end',
      end,
      capHits,
      ...(record.aborted && { aborted: record.aborted }),
      ...(failure && { failure }),
      ...(failed && { driverFailure: failed, attempts: priorFailures(dir, spec.id) + 1 }),
      traceMismatch,
      otherTools,
      spawned,
      finalText: result?.finalText ?? '',
      usage,
      totalTokens: tokens,
      durationMs: result?.durationMs ?? 0,
      turns: result?.turns ?? null,
      // what the CLI left in the real config dirs: listed, never deleted. A Claude file under the trial's own key flags it
      footprint: result?.footprint ?? null,
      load: { start: loadAtStart, end: loadavg() },
      endState: record.endState,
      raw: result?.raw ?? null,
    },
    // metrics.version is METRICS_VERSION, the code that computed them (§9)
    { kind: 'metrics', ...metrics },
  ]
  writeFileSync(
    path.join(dir, `${spec.id}.jsonl`),
    `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`,
  )
  // read from the lines just written, as a resume reads them, so a run and its resume agree: the resolved model is the
  // trace's, which for codex is the -m id it ran
  return resultOf(spec, lines[0] as Line, lines.at(-2) as Line, metrics)
}

/** A driver failure's record, beside the trial's other files: its class, when, the CLI's exit code, and any extra. */
export const recordFailure = (
  dir: string,
  id: string,
  failed: { kind: string; detail: string },
  result: DriverResult | undefined,
  extra: Record<string, unknown> = {},
) =>
  writeFileSync(
    path.join(dir, `${id}.failure.json`),
    JSON.stringify({
      ...failed,
      at: new Date().toISOString(),
      exitCode: result?.exitCode ?? null,
      ...extra,
    }),
  )

/**
 * The driver's record of its calls against the server's: a mismatch marks the trial (§5.1). Any other tool the CLI
 * called is recorded apart, and a sub-agent spawn marks the trial (§8).
 */
export const traceCheck = (
  result: DriverResult | undefined,
  known: ReadonlySet<string>,
  calls: readonly { tool: string }[],
) => {
  const names = (result?.trace ?? []).map((t) => t.name.replace(/^mcp__bench__/, ''))
  const otherTools = names.filter((n) => !known.has(n))
  return {
    otherTools,
    spawned: otherTools.some((n) => /spawn/i.test(n)),
    traceMismatch:
      canonicalJson(names.filter((n) => known.has(n))) !== canonicalJson(calls.map((c) => c.tool)),
  }
}

// canary mode's plan (boundary review #7, the planner, 2026-11-18): the preflight alone needs drivers and models, not
// conditions, so it's one spec per driver and model, condition A. The Claude models with a v2 canary baseline, so the
// baseline's keys and checks are unchanged; Codex stays out until its isolation is solved
export const canaryPlan = (): TrialSpec[] =>
  [PILOT_MODELS.sonnet, PILOT_MODELS.haiku, PILOT_MODELS.opus].map((model, index) => ({
    id: `canary-A-T6-${model}`.replace(/[^\w.-]/g, '_'),
    condition: 'A',
    task: 'T6',
    model,
    driver: 'claude-cli',
    index,
  }))

// M5's runs, closed: their plans are on record at their commits, so their modes refuse rather than run a changed plan
const RETIRED: Record<string, string> = {
  pilot: '4893655c032c1ee57ef8450a747dfc50a1ecfaf2',
  calibration: 'c81eeeb1a61e0330be34ce170169c8d9a77292cc',
}
export const retiredMode = (mode: string): string | undefined =>
  RETIRED[mode] && `M5 is closed: the ${mode} plan is on record at its commit, ${RETIRED[mode]}`

// the pilot (§8, as the planner sized it): 110 trials, five per cell
export const PILOT_MODELS = {
  // Codex's default model, pinned by exact id with -m (the planner, 2026-11-18)
  codex: 'gpt-6.1-terra',
  sonnet: 'claude-sonnet-5-5',
  haiku: 'claude-haiku-5-5',
  opus: 'claude-opus-5-5',
}
export const pilotPlan = (codexModel = PILOT_MODELS.codex): TrialSpec[] => {
  const cells: { condition: ConditionId; task: string; model: string; driver: string }[] = []
  for (const model of [PILOT_MODELS.sonnet, PILOT_MODELS.haiku]) {
    for (const condition of ['A', 'C', 'D', 'E', 'S', 'B'] as const)
      cells.push({ condition, task: 'T3', model, driver: 'claude-cli' })
    for (const condition of ['F', 'G'] as const)
      cells.push({ condition, task: 'T1', model, driver: 'claude-cli' })
  }
  for (const [model, driver] of [
    [PILOT_MODELS.opus, 'claude-cli'],
    [codexModel, 'codex-cli'],
  ] as const)
    for (const condition of ['A', 'C', 'S'] as const)
      cells.push({ condition, task: 'T3', model, driver })
  return cells.flatMap((c) =>
    Array.from({ length: 5 }, (_, index) => ({
      ...c,
      index,
      id: `${c.condition}-${c.task}-${c.model}-${index}`.replace(/[^\w.-]/g, '_'),
    })),
  )
}

// calibration (RFC 0003 §8, intake 2026-11-18): A, C and S × Sonnet and Haiku × T6 and T7 × 5, and A on T3 × the two
// models × 5. 70 trials. The primary task is chosen from A's optimal rate alone (§8's rule), never from C or S
export const calibrationPlan = (): TrialSpec[] => {
  const cells: { condition: ConditionId; task: string; model: string; driver: string }[] = []
  for (const model of [PILOT_MODELS.sonnet, PILOT_MODELS.haiku]) {
    for (const task of ['T6', 'T7'])
      for (const condition of ['A', 'C', 'S'] as const)
        cells.push({ condition, task, model, driver: 'claude-cli' })
    cells.push({ condition: 'A', task: 'T3', model, driver: 'claude-cli' })
  }
  return cells.flatMap((c) =>
    Array.from({ length: 5 }, (_, index) => ({
      ...c,
      index,
      id: `cal-${c.condition}-${c.task}-${c.model}-${index}`.replace(/[^\w.-]/g, '_'),
    })),
  )
}

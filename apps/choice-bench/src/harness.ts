import * as lab from '@affordances/hosting-lab/trial'
import { canonicalJson } from '@affordances/ir'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { conditions, type ConditionId } from './conditions.ts'
import type { Driver, DriverResult } from './drivers/types.ts'
import { computeMetrics, type EndReason } from './metrics.ts'
import type { ServerConfig, ServerRecord } from './server.ts'
import { MAX_CALLS, TOOLS } from './tools.ts'

// RFC 0003 §5 and §9: one trial through one driver, capped, traced, and scored against the task's ground truth

// §5.3: the same paragraph for every trial, then the task's text
export const INSTRUCTIONS =
  'You act for the user below. Use the tools to find options, and request what the user needs. When an action needs the user’s approval, request it; the user answers.'
export const promptFor = (task: lab.Task) => `${INSTRUCTIONS}\n\nThe user: ${task.text}`

// §5.2's caps; the tool-call cap is the server's
export const CAPS = { calls: MAX_CALLS, turns: 40, tokens: 150_000, ms: 10 * 60_000 }

export type TrialSpec = {
  id: string
  condition: ConditionId
  task: string
  model: string
  driver: string
  index: number // within its cell: the plan-id order and the fake driver's seed
}

const SERVER = path.resolve(import.meta.dirname, 'server.ts')

export const runTrial = async (spec: TrialSpec, driver: Driver, dir: string) => {
  mkdirSync(dir, { recursive: true })
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
  if (!existsSync(out))
    throw new Error(`trial ${spec.id}: the tool server never started (${failure ?? 'no error'})`)
  const record = JSON.parse(readFileSync(out, 'utf8')) as ServerRecord
  const usage = result?.usage ?? { inputTokens: 0, outputTokens: 0 }
  // the cap counts everything the trial consumed, cache reads and writes included: Claude reports most of its input
  // as cache (§6's tokens metric stays input plus output, with the cache apart)
  const tokens =
    usage.inputTokens +
    usage.outputTokens +
    (usage.cacheReadTokens ?? 0) +
    (usage.cacheWriteTokens ?? 0)
  const capHits = [
    record.capped && 'calls',
    tokens > CAPS.tokens && 'tokens',
    (result?.durationMs ?? 0) >= CAPS.ms && 'time',
    // a CLI stopped at its turn limit exits nonzero with no final text
    result && result.exitCode !== 0 && !result.finalText && 'turns',
  ].filter((x): x is string => typeof x === 'string')
  const end: EndReason = record.aborted ? 'aborted' : capHits.length || failure ? 'capped' : 'final'
  // the driver's record of its benchmark calls against the server's: a mismatch marks the trial (§5.1). Any other
  // tool the CLI called is recorded apart, and a sub-agent spawn marks the trial (§8)
  const names = (result?.trace ?? []).map((t) => t.name.replace(/^mcp__bench__/, ''))
  const driverCalls = names.filter((n) => n in TOOLS)
  const otherTools = names.filter((n) => !(n in TOOLS))
  const spawned = otherTools.some((n) => /spawn/i.test(n))
  const traceMismatch =
    canonicalJson(driverCalls) !== canonicalJson(record.calls.map((c) => c.tool))
  const metrics = computeMetrics(record, result ?? { usage, durationMs: 0 }, end)
  const policy = conditions[spec.condition].policy
  const lines = [
    {
      kind: 'trial',
      ...spec,
      cli: result?.cli ?? null,
      plans: record.plans,
      startedAt,
      fixture: { manifestDigest: record.manifestDigest, policy },
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
      traceMismatch,
      otherTools,
      spawned,
      finalText: result?.finalText ?? '',
      usage,
      totalTokens: tokens,
      durationMs: result?.durationMs ?? 0,
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
  return { spec, end, capHits, traceMismatch, spawned, metrics }
}

// the pilot (§8, as the planner sized it): 110 trials, five per cell
export const PILOT_MODELS = {
  sonnet: 'claude-sonnet-5-5',
  haiku: 'claude-haiku-5-5',
  opus: 'claude-opus-5-5',
}
export const pilotPlan = (codexModel: string): TrialSpec[] => {
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

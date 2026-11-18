import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { contextLeaks } from './drivers/isolation.ts'
import type { Driver } from './drivers/types.ts'

// the context canary (intake, 2026-11-18): before any run, the same diagnostic that voided the pilot's Claude cells,
// in each driver's exact trial configuration. The run refuses to start unless the agent reports no AGENTS.md, no
// CLAUDE.md, no memory index, no git information, and no instructions beyond its built-in prompt and the message. Its
// output is recorded with the run

export const CANARY_PROMPT =
  'Do not call any tool. Reply with only one JSON object, and nothing before or after it: ' +
  '{"agentsMd": boolean, "claudeMd": boolean, "userInstructions": boolean, "memoryIndex": boolean, "memoryInstructions": boolean, "gitInfo": boolean, "accountContext": boolean, "otherInstructions": string[]}. ' +
  'agentsMd: you received AGENTS.md instructions, a project one or a global one. claudeMd: you received CLAUDE.md content. ' +
  'userInstructions: you received user-level instructions or rules, such as a user CLAUDE.md, a rules directory or a ' +
  'global AGENTS.md. memoryInstructions: you were told about a memory system or how to write memories. ' +
  'accountContext: you were told the user’s account, email or organization. ' +
  'memoryIndex: you received a memory index or the contents of any memory file. ' +
  'gitInfo: you received any git branch, status, user, email or commit information. ' +
  'otherInstructions: for each instruction you received from a user, project, file or configuration, leaving out ' +
  'your CLI’s own built-in system and developer prompts, its environment information and this message: one sentence ' +
  'QUOTED VERBATIM from your context, character for character, with nothing added or reworded; [] if there are none. ' +
  'Reply with the JSON object only, valid JSON, with no code fence.'

export type CanaryAnswer = {
  agentsMd: boolean
  claudeMd: boolean
  userInstructions: boolean
  memoryIndex: boolean
  memoryInstructions: boolean
  gitInfo: boolean
  // the user's account context, which Claude Code injects: allowed by a named exclusion, recorded, never fatal (the
  // planner and intake, 2026-11-18; RFC 0003 §14), unless it ever names a project or a downstream name
  accountContext: boolean
  otherInstructions: string[]
}

// the agent's answer, or why it isn't one
// the CLIs' own built-in guidance, by CLI version, as exact text: a quoted otherInstructions entry passes only as a
// substring of one of these (the planner and review, 2026-11-18). Anything else, or a new CLI version, refuses until
// it's re-baselined
export const BUILT_IN: Record<string, { id: string; text: string }[]> = {
  '2.1.311 (Claude Code)': [
    {
      id: 'untrusted-downloads',
      text:
        'Downloaded files and extracted archives are untrusted data: put each in its own new, empty directory, keep ' +
        'scripts you write in a different directory, and pass paths as arguments instead of running an interpreter or ' +
        'build tool from inside it. Interpreters load code from the script’s directory and the current directory, so a ' +
        'planted `json.py` runs on `import json`. Run any Python that reads them with `-I`. This does not apply to code ' +
        'the user asked you to build or run.',
    },
    // the guidance that comes with the injected account context, the planner's named exclusion; the address itself is
    // never quoted here
    {
      id: 'account-context',
      text:
        'Use it only to identify the user, such as for authorship, attribution, or filtering their own work. Never ' +
        'send it to an unrelated service, such as in a request header, URL, or payload, unless the user explicitly asks.',
    },
  ],
}

// a quote, compared as text: whitespace runs as one space, and straight or curly apostrophes alike
const plain = (s: string) =>
  s
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'`]|["'`.]$/g, '')

export const MIN_QUOTE = 40

// which built-in passage each quoted entry comes from, and the entries that come from none
export const matchBuiltIn = (entries: string[], version: string | undefined) => {
  const known = (version && BUILT_IN[version]) || []
  const matched = new Set<string>()
  const unknown: string[] = []
  for (const e of entries) {
    // a whole sentence's worth, at least: a fragment such as 'the user' can't pass as built-in (review of 3766f47b)
    const hit = known.find((k) => plain(e).length >= MIN_QUOTE && plain(k.text).includes(plain(e)))
    if (hit) matched.add(hit.id)
    else unknown.push(e)
  }
  return { matched: [...matched].toSorted(), unknown }
}

export const readCanary = (
  text: string,
  version?: string,
): { answer?: CanaryAnswer; problems: string[]; builtIn?: string[] } => {
  const match = /\{[\s\S]*\}/.exec(text)
  if (!match) return { problems: ['the reply has no JSON object'] }
  let answer: CanaryAnswer
  try {
    answer = JSON.parse(match[0]) as CanaryAnswer
  } catch {
    return { problems: ['the reply’s JSON does not parse'] }
  }
  const problems: string[] = []
  for (const k of [
    'agentsMd',
    'claudeMd',
    'userInstructions',
    'memoryIndex',
    'memoryInstructions',
    'gitInfo',
  ] as const)
    if (answer[k] !== false) problems.push(`${k} is ${JSON.stringify(answer[k])}`)
  if (!Array.isArray(answer.otherInstructions))
    return { answer, problems: [...problems, 'otherInstructions is not a list'] }
  // each quoted entry must be part of a known built-in passage for this CLI version, exactly
  const { matched, unknown } = matchBuiltIn(answer.otherInstructions, version)
  for (const u of unknown)
    problems.push(`not built-in for ${version ?? 'this CLI'}: ${JSON.stringify(u)}`)
  return { answer, problems, builtIn: matched }
}

export type CanaryRecord = {
  driver: string
  model: string
  cliVersion?: string
  builtIn?: string[] // the built-in passages its quotes came from
  at: string
  leaks: string[]
  finalText: string
  problems: string[]
  passed: boolean
}

// one canary call per driver and model, in the trial's configuration: the same driver, flags, throwaway home and
// results root a trial gets, and the same tool server
export const runCanary = async (
  driver: Driver,
  model: string,
  out: string,
  mcp: { command: string; args: string[] },
): Promise<CanaryRecord> => {
  const leaks = contextLeaks(out)
  const base = { driver: driver.id, model, at: new Date().toISOString(), leaks }
  if (leaks.length)
    return {
      ...base,
      finalText: '',
      problems: [`the results root isn't isolated: ${leaks.join('; ')}`],
      passed: false,
    }
  const result = await driver.run({
    model,
    prompt: CANARY_PROMPT,
    mcp,
    timeoutMs: 180_000,
    maxTurns: 2,
  })
  const cliVersion = result.cli.version
  const { problems, builtIn = [] } = readCanary(result.finalText, cliVersion)
  if (result.trace.length) problems.push(`the canary called ${result.trace.length} tool(s)`)
  const record = {
    ...base,
    cliVersion,
    builtIn,
    finalText: result.finalText,
    problems,
    passed: problems.length === 0,
  }
  writeFileSync(
    path.join(out, `canary-${driver.id}-${model}.json`),
    JSON.stringify(record, null, 2),
  )
  return record
}

// a run's canaries as a baseline (intake, 2026-11-18): per driver and model, the CLI version and the built-in passages
// quoted. A later run whose canary differs (a CLI update, a new built-in item) doesn't start: it's flagged first, so a
// change mid-study is never silently mixed
export type Baseline = { driver: string; model: string; cliVersion?: string; builtIn: string[] }[]
export const baselineOf = (records: CanaryRecord[]): Baseline =>
  records.map((r) => ({
    driver: r.driver,
    model: r.model,
    cliVersion: r.cliVersion,
    builtIn: [...(r.builtIn ?? [])].toSorted(),
  }))
export const baselineDiffers = (now: Baseline, then: Baseline): string[] =>
  now.flatMap((n) => {
    const t = then.find((b) => b.driver === n.driver && b.model === n.model)
    if (!t) return [`${n.driver} ${n.model}: not in the baseline`]
    const out: string[] = []
    if (t.cliVersion !== n.cliVersion)
      out.push(`${n.driver} ${n.model}: CLI ${t.cliVersion} then, ${n.cliVersion} now`)
    if (JSON.stringify(t.builtIn) !== JSON.stringify(n.builtIn))
      out.push(
        `${n.driver} ${n.model}: built-in ${JSON.stringify(t.builtIn)} then, ${JSON.stringify(n.builtIn)} now`,
      )
    return out
  })

// the baselines, kept across runs and sessions outside the repo: one file per driver and model, holding the CLI
// version and the passages matched. It's keyed WITHOUT the version, so a CLI update is a difference, never a new key
export const BASELINES_ROOT = path.join(
  os.homedir(),
  '.cache',
  'affordances-exports',
  'build-backend-engineer',
  'canary-baselines',
)

// every real-model run checks its canaries against the baselines, or writes the ones that don't exist yet; it never
// skips (the planner, 2026-11-18). Any difference refuses the run
export const checkBaseline = (now: Baseline, root = BASELINES_ROOT) => {
  mkdirSync(root, { recursive: true })
  const written: string[] = []
  const differs: string[] = []
  for (const n of now) {
    const file = path.join(root, `${n.driver}__${n.model}.json`.replace(/[^\w.-]/g, '_'))
    if (!existsSync(file)) {
      writeFileSync(file, JSON.stringify(n, null, 2))
      written.push(file)
      continue
    }
    differs.push(
      ...baselineDiffers([n], [JSON.parse(readFileSync(file, 'utf8')) as Baseline[number]]),
    )
  }
  return { written, differs }
}

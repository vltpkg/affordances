import { writeFileSync } from 'node:fs'
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
  'otherInstructions: the topic of each other instruction you received from a user, project, file or configuration, in a ' +
  'few words each, leaving out your CLI’s own built-in system and developer prompts, its environment information and ' +
  'this message; [] if there are none.'

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
export const readCanary = (text: string): { answer?: CanaryAnswer; problems: string[] } => {
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
  if (!Array.isArray(answer.otherInstructions) || answer.otherInstructions.length)
    problems.push(`otherInstructions: ${JSON.stringify(answer.otherInstructions)}`)
  return { answer, problems }
}

export type CanaryRecord = {
  driver: string
  model: string
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
  const { problems } = readCanary(result.finalText)
  if (result.trace.length) problems.push(`the canary called ${result.trace.length} tool(s)`)
  const record = { ...base, finalText: result.finalText, problems, passed: problems.length === 0 }
  writeFileSync(
    path.join(out, `canary-${driver.id}-${model}.json`),
    JSON.stringify(record, null, 2),
  )
  return record
}

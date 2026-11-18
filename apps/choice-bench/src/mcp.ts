import { canonicalJson } from '@affordances/ir'
import type { ConditionId } from './conditions.ts'
import type { McpCall, McpRecord } from './mcp-server.ts'

// the MCP pilot surface's request events (surfaces/PLAN.md §5): its consequential execute, refused for confirmation
// or run. Its tools are the generic four, so a request names its offer, as on full; and the person's approval is MCP's
// elicitation, never a token the model holds

/** An MCP trial's record, with what the replay needs. */
export type McpTrial = McpRecord & {
  condition: ConditionId
  index: number
  task: string
  project: string
}

type Execution = { status?: string; code?: string }
const execution = (c: McpCall) =>
  c.tool === 'execute' && typeof c.output === 'object' && c.output
    ? (c.output as Execution)
    : undefined

export const mcpRequestEvent = (c: McpCall) => {
  const e = execution(c)
  return (
    !!e &&
    (e.status === 'succeeded' || (e.status === 'refused' && e.code === 'confirmation_required'))
  )
}

/** The request events, in order, each once: an offer and its input. */
export const mcpRequestsOf = (record: Pick<McpRecord, 'calls'>) => {
  const seen = new Set<string>()
  return record.calls.filter(mcpRequestEvent).flatMap((c) => {
    const r = { offer: String(c.input.offer), input: c.input.input }
    const key = canonicalJson({ offer: r.offer, input: r.input ?? null })
    if (seen.has(key)) return []
    seen.add(key)
    return [r]
  })
}

/** Completed: an execute that ran while the person accepted an elicitation within that same call. */
export const mcpCompleted = (record: Pick<McpRecord, 'calls' | 'elicitations'>) =>
  record.calls.some(
    (c) =>
      execution(c)?.status === 'succeeded' &&
      record.elicitations.some(
        (e) =>
          e.at >= c.at &&
          e.at <= c.at + c.ms &&
          (e.answer as { action?: string } | undefined)?.action === 'accept',
      ),
  )

/** The pilot's finding: whether the client declared MCP's elicitation at initialize. */
export const declaresElicitation = (record: Pick<McpRecord, 'clientCapabilities'>) =>
  !!record.clientCapabilities && 'elicitation' in record.clientCapabilities

export const mcpUnauthorized = (record: Pick<McpRecord, 'calls'>) =>
  record.calls.some((c) => execution(c)?.code === 'unauthorized')

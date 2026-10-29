import Anthropic from '@anthropic-ai/sdk'

export const DEFAULT_MODEL = 'claude-opus-5-5'
// pinned so both agents think the same amount (opus 5.5 and haiku 5.5 default to medium anyway)
export const EFFORT = 'medium'
const MAX_TURNS = 40

// list prices, USD per million tokens; cache writes are the 5-minute kind (1.25× input)
// ponytail: hand-copied list prices, update when they change (or read them from the models API)
export const PRICES: Record<
  string,
  { input: number; output: number; cacheRead: number; cacheWrite: number }
> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
}

// tools that change or act on the page, as opposed to reading it: the first one is "time to first action"
const ACTIONS = new Set(['affordances_call', 'click', 'fill', 'press'])

export type Tool = Anthropic.Tool & { run: (input: Record<string, unknown>) => Promise<string> }

export type Call = { tool: string; input: unknown; ms: number; bytes: number; error?: string }

// what the loop reports as it goes, for the recorder; the bench itself doesn't listen
export type LoopEvent =
  | {
      type: 'turn'
      turn: number
      ms: number
      usage: { input: number; cacheRead: number; cacheWrite: number; output: number }
      text: string
      calls: { id: string; name: string; input: unknown }[]
      // the tools offered on this turn
      tools: string[]
    }
  | {
      type: 'tool'
      turn: number
      id: string
      name: string
      input: unknown
      result: string
      ms: number
      error?: string
    }

export type RunStats = {
  success: boolean
  turns: number
  toolCalls: number
  // every token the model read or wrote, as one number (what the summary's medianTokens is made of)
  tokens: number
  inputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
  costUsd: number
  ms: number
  // from the first request to the first tool call that acts (affordances_call, click, fill, press)
  firstActionMs: number | null
  stop: string
  // the model's last text, for tasks that ask a question
  answer: string
  trace: Call[]
  error?: string
}

const client = new Anthropic()

export const emptyStats = (extra: Partial<RunStats> = {}): Omit<RunStats, 'success'> => ({
  turns: 0,
  toolCalls: 0,
  tokens: 0,
  inputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  costUsd: 0,
  ms: 0,
  firstActionMs: null,
  stop: 'none',
  answer: '',
  trace: [],
  ...extra,
})

// one task, one agent: loop until the model stops calling tools (or a turn cap), counting everything
export const runAgent = async (
  model: string,
  system: string,
  prompt: string,
  // a function for a toolbox that changes as the agent goes, e.g. tools a page registers over WebMCP
  tools: Tool[] | (() => Promise<Tool[]>),
  onEvent?: (event: LoopEvent) => void,
): Promise<Omit<RunStats, 'success'>> => {
  const price = PRICES[model]
  if (!price) throw new Error(`No price for ${model}; add it to PRICES in src/loop.ts`)
  const started = performance.now()
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: prompt }]
  const stats = emptyStats({ stop: 'turn_cap' })

  while (stats.turns < MAX_TURNS) {
    const toolbox = typeof tools === 'function' ? await tools() : tools
    const definitions: Anthropic.Tool[] = toolbox.map(({ name, description, input_schema }) => ({
      name,
      description,
      input_schema,
    }))
    const byName = new Map(toolbox.map((tool) => [tool.name, tool]))
    const asked = performance.now()
    const response = await client.messages.create({
      model,
      max_tokens: 16000,
      output_config: { effort: EFFORT },
      // tools + system never change within a run, so every turn after the first reads them from cache
      cache_control: { type: 'ephemeral' },
      system,
      tools: definitions,
      messages,
    })
    stats.turns++
    const { usage } = response
    stats.inputTokens += usage.input_tokens
    stats.cacheReadTokens += usage.cache_read_input_tokens ?? 0
    stats.cacheWriteTokens += usage.cache_creation_input_tokens ?? 0
    stats.outputTokens += usage.output_tokens

    const text = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n')
    if (text) stats.answer = text
    const calls = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    onEvent?.({
      type: 'turn',
      turn: stats.turns,
      ms: Math.round(performance.now() - asked),
      usage: {
        input: usage.input_tokens,
        cacheRead: usage.cache_read_input_tokens ?? 0,
        cacheWrite: usage.cache_creation_input_tokens ?? 0,
        output: usage.output_tokens,
      },
      text,
      calls: calls.map(({ id, name, input }) => ({ id, name, input })),
      tools: toolbox.map((tool) => tool.name),
    })
    // refusal, end_turn, max_tokens: the run is over (a truncated tool input is never executed)
    if (response.stop_reason !== 'tool_use' || !calls.length) {
      stats.stop = response.stop_reason ?? 'unknown'
      break
    }
    messages.push({ role: 'assistant', content: response.content })
    const results: Anthropic.ToolResultBlockParam[] = []
    for (const call of calls) {
      stats.toolCalls++
      if (stats.firstActionMs === null && ACTIONS.has(call.name))
        stats.firstActionMs = Math.round(performance.now() - started)
      const tool = byName.get(call.name)
      const at = performance.now()
      try {
        if (!tool) throw new Error(`No tool named ${call.name}`)
        const content = await tool.run(call.input as Record<string, unknown>)
        stats.trace.push({
          tool: call.name,
          input: call.input,
          ms: Math.round(performance.now() - at),
          bytes: content.length,
        })
        onEvent?.({
          type: 'tool',
          turn: stats.turns,
          id: call.id,
          name: call.name,
          input: call.input,
          result: content,
          ms: Math.round(performance.now() - at),
        })
        results.push({ type: 'tool_result', tool_use_id: call.id, content })
      } catch (error) {
        const message = (error as Error).message
        stats.trace.push({
          tool: call.name,
          input: call.input,
          ms: Math.round(performance.now() - at),
          bytes: 0,
          error: message,
        })
        onEvent?.({
          type: 'tool',
          turn: stats.turns,
          id: call.id,
          name: call.name,
          input: call.input,
          result: message,
          ms: Math.round(performance.now() - at),
          error: message,
        })
        results.push({
          type: 'tool_result',
          tool_use_id: call.id,
          is_error: true,
          content: message,
        })
      }
    }
    messages.push({ role: 'user', content: results })
  }
  stats.tokens =
    stats.inputTokens + stats.cacheReadTokens + stats.cacheWriteTokens + stats.outputTokens
  stats.costUsd =
    (stats.inputTokens * price.input +
      stats.cacheReadTokens * price.cacheRead +
      stats.cacheWriteTokens * price.cacheWrite +
      stats.outputTokens * price.output) /
    1e6
  return { ...stats, ms: Math.round(performance.now() - started) }
}

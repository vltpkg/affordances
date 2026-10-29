import Anthropic from '@anthropic-ai/sdk'

export const MODEL = 'claude-opus-5-5'
// pinned so both agents think the same amount; opus 5.5 defaults to medium anyway
export const EFFORT = 'medium'
const MAX_TURNS = 40

export type Tool = Anthropic.Tool & { run: (input: Record<string, unknown>) => Promise<string> }

export type RunStats = {
  success: boolean
  turns: number
  toolCalls: number
  inputTokens: number
  outputTokens: number
  ms: number
  stop: string
  // the model's last text, for tasks that ask a question
  answer: string
  error?: string
}

const client = new Anthropic()

// one task, one agent: loop until the model stops calling tools (or a turn cap), counting everything
export const runAgent = async (
  system: string,
  prompt: string,
  tools: Tool[],
): Promise<Omit<RunStats, 'success'>> => {
  const started = performance.now()
  const definitions: Anthropic.Tool[] = tools.map(({ name, description, input_schema }) => ({
    name,
    description,
    input_schema,
  }))
  const byName = new Map(tools.map((tool) => [tool.name, tool]))
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: prompt }]
  const stats = {
    turns: 0,
    toolCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    stop: 'turn_cap',
    answer: '',
  }

  while (stats.turns < MAX_TURNS) {
    const response = await client.messages.create({
      model: MODEL,
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
    stats.inputTokens +=
      usage.input_tokens +
      (usage.cache_creation_input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0)
    stats.outputTokens += usage.output_tokens

    const text = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n')
    if (text) stats.answer = text
    const calls = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    // refusal, end_turn, max_tokens: the run is over (a truncated tool input is never executed)
    if (response.stop_reason !== 'tool_use' || !calls.length) {
      stats.stop = response.stop_reason ?? 'unknown'
      break
    }
    messages.push({ role: 'assistant', content: response.content })
    const results: Anthropic.ToolResultBlockParam[] = []
    for (const call of calls) {
      stats.toolCalls++
      const tool = byName.get(call.name)
      try {
        if (!tool) throw new Error(`No tool named ${call.name}`)
        results.push({
          type: 'tool_result',
          tool_use_id: call.id,
          content: await tool.run(call.input as Record<string, unknown>),
        })
      } catch (error) {
        results.push({
          type: 'tool_result',
          tool_use_id: call.id,
          is_error: true,
          content: (error as Error).message,
        })
      }
    }
    messages.push({ role: 'user', content: results })
  }
  return { ...stats, ms: Math.round(performance.now() - started) }
}

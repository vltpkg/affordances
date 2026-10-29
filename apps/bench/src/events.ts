// what the recorder emits, one JSON object per line: both agents race the same task on one clock, and apps/demo
// replays (or streams) these. `at` is ms since the run started, shared by both agents

export type AgentKind = 'browser' | 'afford' | 'webmcp'

export type Usage = { input: number; cacheRead: number; cacheWrite: number; output: number }

export type DemoEvent =
  | {
      type: 'run'
      id: string
      task: { id: string; prompt: string }
      model: string
      startedAt: string
    }
  // the agent's tools and system prompt: the first thing the model reads, before the task
  | {
      type: 'agent'
      agent: AgentKind
      system: string
      tools: { name: string; description: string }[]
    }
  // one model response: what it said, and the tools it asked for
  | {
      type: 'turn'
      agent: AgentKind
      at: number
      turn: number
      ms: number
      usage: Usage
      text: string
      calls: { id: string; name: string; input: unknown }[]
      // the tools offered on this turn (missing in recordings from before WebMCP)
      tools?: string[]
    }
  // one tool result, exactly as the model reads it on its next turn
  | {
      type: 'tool'
      agent: AgentKind
      at: number
      turn: number
      id: string
      name: string
      input: unknown
      result: string
      ms: number
      error?: string
    }
  // what a person would see right after that tool ran; never shown to the model
  | { type: 'frame'; agent: AgentKind; at: number; id: string; url: string; image: string }
  | {
      type: 'done'
      agent: AgentKind
      at: number
      success: boolean
      answer: string
      stop: string
      turns: number
      toolCalls: number
      tokens: number
      costUsd: number
      error?: string
    }
  | { type: 'end'; at: number }

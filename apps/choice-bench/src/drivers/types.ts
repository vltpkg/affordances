// RFC 0003 §5.1: a driver runs one agent on one prompt with a fixed set of tools, and returns a trace

export type Trial = {
  model: string
  prompt: string // the harness's fixed instructions (§5.3), then the task text
  mcp: { command: string; args: string[] } | { url: string } // the benchmark's tools, for this trial's runtime
  timeoutMs: number
  maxTurns: number
}

export type DriverResult = {
  trace: { name: string; input: unknown; resultBytes: number; ms: number }[] // as the driver saw its tool calls
  finalText: string
  usage: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
  }
  durationMs: number
  exitCode: number
  cli: { name: string; version: string }
  resolvedModel?: string // the model the CLI says it ran, when it says
  // model turns: claude's own count; codex reports none, so its tool calls plus the final message
  turns?: number
  // the CLI's own signal that it stopped at its turn limit: claude's result subtype error_max_turns. Codex has no turn
  // flag, so its limit is the tool server's calls cap (boundary review #8)
  stopped?: 'turns'
  // the CLI's own structured error when it failed: claude's is_error result, codex's error and turn.failed events. The
  // harness classes a failure as auth or overloaded by this alone (review of 006e2902)
  error?: string
  // what the CLI wrote to stderr: kept for the record, never classed by, since it can echo tool output, and the
  // benchmark's own refusals say 'unauthorized'
  stderr?: string
  // what the run left in the real config dirs, listed and never deleted (isolation.ts)
  footprint?: import('./isolation.ts').Footprint
  raw: string // the path of the stored stdout
  // what a scripted driver did beyond its plain script, so the trace shows it (the planner, 16:27Z)
  notes?: string[]
}

export type Driver = {
  id: string // 'claude-cli', 'codex-cli'
  run(trial: Trial): Promise<DriverResult>
}

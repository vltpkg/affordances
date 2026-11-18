import { freshDir, json, runCli, trialEnv, versionOf, type Ran } from './process.ts'
import type { Driver, DriverResult } from './types.ts'

// codex exec, with only the benchmark's tools (RFC 0003 §5.1, §5.3): the user's config, plugins, hooks and every
// built-in tool that reaches past them (the shell, the browser, other agents) are off, the session isn't kept, and
// the benchmark's server is pre-approved, since codex otherwise refuses MCP calls under exec. Codex has no turn
// limit flag, so maxTurns is the harness's to enforce at its tool server (a cap past which every call refuses)
const SERVER = 'bench'
// every feature that gives the agent something besides the benchmark's tools, or hides those behind a search
export const DISABLED = [
  'shell_tool',
  'unified_exec',
  'apps',
  'browser_use',
  'browser_use_external',
  'computer_use',
  'image_generation',
  'view_image',
  'multi_agent',
  'plugins',
  'hooks',
  'goals',
  'sleep_tool',
  'skill_search',
  'tool_suggest',
  'tool_search_always_defer_mcp_tools',
]
// kept on: code_mode_host, through which codex calls MCP tools at all (with it off, the benchmark's tools vanish).
// codex's collaboration tools (spawn_agent and the rest) have no switch of their own here; a sub-agent has only the
// same tools, and its calls reach the same server, which records them
const toml = (value: unknown) => JSON.stringify(value)

export const codexCli = (options: {
  root: string
  command?: string
  disabled?: string[]
}): Driver => {
  const command = options.command ?? 'codex'
  let version: string | undefined
  return {
    id: 'codex-cli',
    async run(trial) {
      version ??= versionOf(command)
      const dir = freshDir(options.root, 'codex')
      const server =
        'url' in trial.mcp
          ? [`mcp_servers.${SERVER}.url=${toml(trial.mcp.url)}`]
          : [
              `mcp_servers.${SERVER}.command=${toml(trial.mcp.command)}`,
              `mcp_servers.${SERVER}.args=${toml(trial.mcp.args)}`,
            ]
      const ran = await runCli(
        command,
        [
          'exec',
          '--json',
          '--ephemeral',
          '--ignore-user-config',
          '--ignore-rules',
          '--skip-git-repo-check',
          '-s',
          'read-only',
          '-C',
          dir,
          '-m',
          trial.model,
          ...server.flatMap((c) => ['-c', c]),
          '-c',
          `mcp_servers.${SERVER}.default_tools_approval_mode="approve"`,
          '-c',
          'web_search="disabled"',
          ...(options.disabled ?? DISABLED).flatMap((f) => ['--disable', f]),
          trial.prompt,
        ],
        { dir, timeoutMs: trial.timeoutMs, env: trialEnv(), stdin: '' },
      )
      return parse(ran, version)
    },
  }
}

// exported for the tests, which feed it recorded output
export const parse = (
  ran: Pick<Ran, 'lines' | 'durationMs' | 'exitCode' | 'timedOut' | 'raw'>,
  version: string,
): DriverResult => {
  const trace: DriverResult['trace'] = []
  const open = new Map<string, { index: number; at: number }>()
  const messages: string[] = []
  const usage: DriverResult['usage'] = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }
  for (const { at, text } of ran.lines) {
    const event = json(text)
    const item = event?.item as Record<string, unknown> | undefined
    // any other tool call codex makes, its collaboration tools (spawn_agent and the rest) above all, goes in the trace
    // under its own name, so the harness can mark the trial and the pilot can count them (review of M5a)
    if (
      item &&
      item.type !== 'mcp_tool_call' &&
      /tool_call|collab/.test(String(item.type)) &&
      event!.type === 'item.started'
    )
      trace.push({
        name: String(item.tool ?? item.name ?? item.type),
        input: item.arguments ?? item,
        resultBytes: 0,
        ms: 0,
      })
    if (item?.type === 'mcp_tool_call') {
      const id = String(item.id)
      if (event!.type === 'item.started') {
        trace.push({ name: String(item.tool), input: item.arguments, resultBytes: 0, ms: 0 })
        open.set(id, { index: trace.length - 1, at })
      } else if (event!.type === 'item.completed') {
        let call = open.get(id)
        if (!call) {
          // a call that completed without a start event
          trace.push({ name: String(item.tool), input: item.arguments, resultBytes: 0, ms: 0 })
          call = { index: trace.length - 1, at }
        }
        const result = item.result as { content?: { type?: string; text?: string }[] } | null
        const body = result
          ? (result.content ?? [])
              .map((c) => (c.type === 'text' ? (c.text ?? '') : JSON.stringify(c)))
              .join('')
          : JSON.stringify(item.error ?? '')
        trace[call.index]!.resultBytes = Buffer.byteLength(body)
        trace[call.index]!.ms = at - call.at
      }
    }
    if (event?.type === 'item.completed' && item?.type === 'agent_message')
      messages.push(String(item.text ?? ''))
    if (event?.type === 'turn.completed') {
      // usage comes per turn: the trial's is their sum
      const u = (event.usage ?? {}) as Record<string, number | undefined>
      // codex's input_tokens includes its cached input; inputTokens is the uncached part, as claude reports it, so a
      // trial's total (input, output and cache) counts each token once
      usage.inputTokens += (u.input_tokens ?? 0) - (u.cached_input_tokens ?? 0)
      usage.outputTokens += (u.output_tokens ?? 0) + (u.reasoning_output_tokens ?? 0)
      usage.cacheReadTokens! += u.cached_input_tokens ?? 0
    }
  }
  return {
    trace,
    finalText: messages.at(-1) ?? '',
    usage,
    durationMs: ran.durationMs,
    exitCode: ran.timedOut ? 124 : ran.exitCode,
    cli: { name: 'codex', version },
    turns: trace.length + 1,
    raw: ran.raw,
  }
}

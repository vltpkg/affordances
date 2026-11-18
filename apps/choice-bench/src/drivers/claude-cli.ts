import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { assertIsolated, makeHome, removeHome } from './isolation.ts'
import { freshDir, json, runCli, trialEnv, versionOf, type Ran } from './process.ts'
import type { Driver, DriverResult } from './types.ts'

// claude -p, with only the benchmark's tools: no built-in tools, no settings, MCP servers or session but this
// trial's, in a fresh directory (RFC 0003 §5.1, §5.3). stream-json gives each tool call and the usage
const SERVER = 'bench'
const PREFIX = `mcp__${SERVER}__`

export const claudeCli = (options: {
  root: string
  command?: string
  isolated?: false
}): Driver => {
  const command = options.command ?? 'claude'
  let version: string | undefined
  return {
    id: 'claude-cli',
    async run(trial) {
      version ??= versionOf(command)
      const dir = freshDir(options.root, 'claude')
      // a home of its own, and nothing of the repo's or the seat's reachable (isolation.ts)
      // isolated: false is the canary's own negative check, never a trial (canary.test.ts)
      const home = options.isolated === false ? undefined : makeHome('claude')
      try {
        if (home) assertIsolated(dir, home)
        const server =
          'url' in trial.mcp
            ? { type: 'http', url: trial.mcp.url }
            : { command: trial.mcp.command, args: trial.mcp.args }
        const config = path.join(dir, 'mcp.json')
        writeFileSync(config, JSON.stringify({ mcpServers: { [SERVER]: server } }))
        const ran = await runCli(
          command,
          [
            '-p',
            trial.prompt,
            '--model',
            trial.model,
            '--output-format',
            'stream-json',
            '--verbose',
            '--mcp-config',
            config,
            '--strict-mcp-config',
            '--tools',
            '',
            '--allowedTools',
            `${PREFIX}*`,
            '--setting-sources',
            '',
            '--disable-slash-commands',
            '--no-session-persistence',
            '--max-turns',
            String(trial.maxTurns),
          ],
          { dir, timeoutMs: trial.timeoutMs, env: { ...trialEnv(), ...home?.env } },
        )
        return parse(ran, version)
      } finally {
        if (home) removeHome(home)
      }
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
  let finalText = ''
  let resolvedModel: string | undefined
  let turns: number | undefined
  const usage: DriverResult['usage'] = { inputTokens: 0, outputTokens: 0 }
  for (const { at, text } of ran.lines) {
    const event = json(text)
    if (!event) continue
    const message = event.message as { content?: unknown[] } | undefined
    // the session's init names the model the alias resolved to
    if (event.type === 'system' && event.subtype === 'init' && typeof event.model === 'string')
      resolvedModel = event.model
    if (event.type === 'assistant')
      for (const part of (message?.content ?? []) as Record<string, unknown>[]) {
        if (part.type !== 'tool_use') continue
        const name = String(part.name)
        trace.push({
          name: name.startsWith(PREFIX) ? name.slice(PREFIX.length) : name,
          input: part.input,
          resultBytes: 0,
          ms: 0,
        })
        open.set(String(part.id), { index: trace.length - 1, at })
      }
    if (event.type === 'user')
      for (const part of (message?.content ?? []) as Record<string, unknown>[]) {
        if (part.type !== 'tool_result') continue
        const call = open.get(String(part.tool_use_id))
        if (!call) continue
        // the text the agent got back: a string, or the text parts of a content list
        const body =
          typeof part.content === 'string'
            ? part.content
            : ((part.content ?? []) as { type?: string; text?: string }[])
                .map((c) => (c.type === 'text' ? (c.text ?? '') : JSON.stringify(c)))
                .join('')
        trace[call.index]!.resultBytes = Buffer.byteLength(body)
        trace[call.index]!.ms = at - call.at
      }
    if (event.type === 'result') {
      finalText = typeof event.result === 'string' ? event.result : ''
      if (typeof event.num_turns === 'number') turns = event.num_turns
      const u = (event.usage ?? {}) as Record<string, number | undefined>
      usage.inputTokens = u.input_tokens ?? 0
      usage.outputTokens = u.output_tokens ?? 0
      if (u.cache_read_input_tokens !== undefined) usage.cacheReadTokens = u.cache_read_input_tokens
      if (u.cache_creation_input_tokens !== undefined)
        usage.cacheWriteTokens = u.cache_creation_input_tokens
    }
  }
  return {
    trace,
    finalText,
    usage,
    durationMs: ran.durationMs,
    exitCode: ran.timedOut ? 124 : ran.exitCode,
    cli: { name: 'claude', version },
    ...(resolvedModel && { resolvedModel }),
    ...(turns !== undefined && { turns }),
    raw: ran.raw,
  }
}

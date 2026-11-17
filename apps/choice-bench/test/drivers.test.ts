import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { parse as claude } from '../src/drivers/claude-cli.ts'
import { DISABLED, parse as codex } from '../src/drivers/codex-cli.ts'
import { trialEnv } from '../src/drivers/process.ts'

// each driver's parser, on the output its CLI wrote in M5a's smoke run (paths and ids replaced)
const recorded = (file: string) => ({
  lines: readFileSync(path.join(import.meta.dirname, 'fixtures', file), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((text, i) => ({ at: i * 10, text })),
  durationMs: 5000,
  exitCode: 0,
  timedOut: false,
  raw: '<raw>',
})

describe('the drivers (RFC 0003 §5.1)', () => {
  test('claude -p: the tool call without its server prefix, the final text, and the usage', () => {
    const r = claude(recorded('claude-stream.jsonl'), '2.1.311 (Claude Code)')
    expect(r.trace).toEqual([
      { name: 'lookup', input: { key: 'color' }, resultBytes: 4, ms: expect.any(Number) },
    ])
    expect(r.finalText).toBe('teal')
    expect(r.usage.outputTokens).toBeGreaterThan(0)
    expect(r.cli).toEqual({ name: 'claude', version: '2.1.311 (Claude Code)' })
  })

  test('codex exec: the tool call, the last agent message, and the turns’ usage summed', () => {
    const r = codex(recorded('codex-exec.jsonl'), 'codex-cli 0.159.0')
    expect(r.trace).toEqual([
      { name: 'lookup', input: { key: 'color' }, resultBytes: 4, ms: expect.any(Number) },
    ])
    expect(r.finalText).toBe('teal')
    expect(r.usage.inputTokens).toBeGreaterThan(0)
  })

  test('a run past its timeout is exit 124, whatever the CLI returned', () => {
    expect(
      claude({ ...recorded('claude-stream.jsonl'), timedOut: true, exitCode: 143 }, 'v').exitCode,
    ).toBe(124)
    expect(
      codex({ ...recorded('codex-exec.jsonl'), timedOut: true, exitCode: 143 }, 'v').exitCode,
    ).toBe(124)
  })

  test('a trial’s environment drops the seat it was started from, and keeps what authenticates', () => {
    const saved = { ...process.env }
    Object.assign(process.env, {
      OPENRIG_SESSION_NAME: 'x',
      CLAUDE_CODE_PLUGIN_DIRS: 'x',
      CLAUDECODE: '1',
      CLAUDE_CONFIG_DIR: '/c',
      CLAUDE_CODE_TMPDIR: '/t',
    })
    try {
      const env = trialEnv()
      expect(
        Object.keys(env).filter(
          (k) =>
            !/^(PATH|HOME|USER|LOGNAME|SHELL|LANG|LC_|TZ|TMPDIR|XDG_|CLAUDE_CONFIG_DIR|CLAUDE_CODE_TMPDIR|CODEX_HOME|SSL_CERT_FILE|NODE_EXTRA_CA_CERTS)/.test(
              k,
            ),
        ),
      ).toEqual([])
      expect([env.CLAUDE_CONFIG_DIR, env.CLAUDE_CODE_TMPDIR]).toEqual(['/c', '/t'])
    } finally {
      process.env = saved
    }
  })

  test('codex: a collaboration call goes in the trace under its own name, so the harness can mark the trial', () => {
    const base = recorded('codex-exec.jsonl')
    const spawn = JSON.stringify({
      type: 'item.started',
      item: {
        id: 'item_9',
        type: 'collab_tool_call',
        tool: 'spawn_agent',
        arguments: { task: 'x' },
      },
    })
    const r = codex({ ...base, lines: [...base.lines, { at: 99, text: spawn }] }, 'v')
    expect(r.trace.map((c) => c.name)).toEqual(['lookup', 'spawn_agent'])
  })

  test('codex keeps code mode on: with it off, MCP tools vanish (found in M5a’s smoke run)', () => {
    expect(DISABLED).not.toContain('code_mode_host')
    expect(DISABLED).toEqual(
      expect.arrayContaining(['shell_tool', 'unified_exec', 'plugins', 'hooks']),
    )
  })
})

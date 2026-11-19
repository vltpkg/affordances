import { createServer } from '@affordances/mcp'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import { readFileSync } from 'node:fs'
import { parsedOrText } from './facts.ts'
import { writeRecordAtomic } from './record-file.ts'

// the v0 surface's tool server, as a driver launches it: node src/v0-server.ts <config.json> (surfaces/PLAN.md §3).
// It's packages/mcp's own createServer, run unchanged against the trial's server with the trial's session as its
// bearer token, and with no instructions, as every surface has none (the preflight checks it). The harness only
// listens: it wraps the stdio transport, recording each tools/list answer and each tools/call with its result, and
// writes the record after every message, so a trial is scorable however it ends

export type V0Config = { url: string; session: string; out: string }
export type V0Call = {
  tool: string
  input: Record<string, unknown>
  // the tool's text, parsed when it's JSON (v0's graph or delta), else the text, as an error's message is
  output: unknown
  isError: boolean
  at: number
  ms: number
}
export type V0Record = {
  surface: 'v0'
  url: string
  // each tools/list answer's tools, exactly as the agent was given them
  toolLists: unknown[]
  calls: V0Call[]
}

type Id = string | number
const config = JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as V0Config
const record: V0Record = { surface: 'v0', url: config.url, toolLists: [], calls: [] }
const save = () => {
  writeRecordAtomic(config.out, record)
}
save()

const asked = new Map<
  Id,
  { method: string; tool?: string; input?: Record<string, unknown>; at: number }
>()
const seen = (m: JSONRPCMessage) => {
  if (!('method' in m) || !('id' in m)) return
  const params = (m.params ?? {}) as { name?: string; arguments?: Record<string, unknown> }
  asked.set(m.id, {
    method: m.method,
    ...(m.method === 'tools/call' && { tool: params.name, input: params.arguments ?? {} }),
    at: Date.now(),
  })
}
const answered = (m: JSONRPCMessage) => {
  if (!('id' in m) || !('result' in m)) return
  const question = asked.get(m.id)
  if (!question) return
  asked.delete(m.id)
  const result = m.result as { tools?: unknown[]; content?: { text?: string }[]; isError?: boolean }
  if (question.method === 'tools/list') record.toolLists.push(result.tools)
  else if (question.method === 'tools/call')
    record.calls.push({
      tool: question.tool!,
      input: question.input!,
      output: parsedOrText(result.content?.map((c) => c.text ?? '').join('') ?? ''),
      isError: result.isError === true,
      at: question.at,
      ms: Date.now() - question.at,
    })
  else return
  save()
}

// the stdio transport, with the harness listening on both directions; nothing it passes is changed
class Recording implements Transport {
  readonly inner = new StdioServerTransport()
  onclose?: () => void
  onerror?: (error: Error) => void
  onmessage?: Transport['onmessage']
  // the SDK's Transport is its callback properties, with no addEventListener to use instead
  async start() {
    // oxlint-disable-next-line unicorn/prefer-add-event-listener
    this.inner.onmessage = (m: JSONRPCMessage) => {
      seen(m)
      this.onmessage?.(m)
    }
    // oxlint-disable-next-line unicorn/prefer-add-event-listener
    this.inner.onclose = () => this.onclose?.()
    // oxlint-disable-next-line unicorn/prefer-add-event-listener
    this.inner.onerror = (e) => this.onerror?.(e)
    await this.inner.start()
  }
  async send(m: JSONRPCMessage) {
    answered(m)
    await this.inner.send(m)
  }
  async close() {
    await this.inner.close()
  }
}

await createServer(config.url, { token: config.session }).connect(new Recording())

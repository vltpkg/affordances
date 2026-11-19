import * as lab from '@affordances/hosting-lab/trial'
import { createMcpServer } from '@affordances/mcp-v1'
import { httpAdapter } from '@affordances/runtime/agent'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import { readFileSync } from 'node:fs'
import { parsedOrText } from './facts.ts'
import { writeRecordAtomic } from './record-file.ts'

// the MCP pilot surface's tool server, as a driver launches it: node src/mcp-server.ts <config.json> (surfaces/
// PLAN.md §3; the planner, 15:55Z). mcp-v1's own server, generic mode, over protocol 1 to the trial's server: its
// adapter option, with the runtime's httpAdapter and a fetcher that adds the trial session's bearer, since Node's
// fetch has no browser cookie. The person confirms through MCP's elicitation, if the client declares it: whether it
// does is the pilot's finding. If it doesn't, execute returns the refusal, which is the request event, and the trial
// ends unconfirmed, with the intended measure only (§3, a harness limit). Nothing simulates a completion here

// project: the trial's own, the connection's start (intake, 16:27Z): every M7f cell starts from the user's project
export type McpConfig = { url: string; session: string; task: string; project: string; out: string }
export type McpCall = {
  tool: string
  input: Record<string, unknown>
  output: unknown
  isError: boolean
  at: number
  ms: number
}
export type McpRecord = {
  surface: 'mcp'
  url: string
  // what the client declared at initialize: the pilot's finding is whether elicitation is among them
  clientCapabilities: Record<string, unknown> | null
  clientInfo: unknown
  toolLists: unknown[]
  calls: McpCall[]
  // each confirmation the server asked the person for, with the client's answer (or its error)
  elicitations: { message: string; at: number; answer?: unknown; error?: unknown }[]
}

const config = JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as McpConfig
const record: McpRecord = {
  surface: 'mcp',
  url: config.url,
  clientCapabilities: null,
  clientInfo: null,
  toolLists: [],
  calls: [],
  elicitations: [],
}
const save = () => {
  writeRecordAtomic(config.out, record)
}
save()

type Id = string | number
const asked = new Map<
  Id,
  { method: string; tool?: string; input?: Record<string, unknown>; at: number }
>()
// the server's own requests to the client: its elicitations, by id
const elicited = new Map<Id, number>()
// a message from the client
const fromClient = (m: JSONRPCMessage) => {
  if ('method' in m && m.method === 'initialize') {
    const p = (m.params ?? {}) as { capabilities?: Record<string, unknown>; clientInfo?: unknown }
    record.clientCapabilities = p.capabilities ?? {}
    record.clientInfo = p.clientInfo ?? null
    save()
  }
  if ('method' in m && 'id' in m) {
    const p = (m.params ?? {}) as { name?: string; arguments?: Record<string, unknown> }
    asked.set(m.id, {
      method: m.method,
      ...(m.method === 'tools/call' && { tool: p.name, input: p.arguments ?? {} }),
      at: Date.now(),
    })
  }
  // the client's answer to an elicitation
  if (!('method' in m) && 'id' in m && m.id !== undefined && elicited.has(m.id)) {
    const e = record.elicitations[elicited.get(m.id)!]!
    if ('result' in m) e.answer = m.result
    if ('error' in m) e.error = m.error
    elicited.delete(m.id)
    save()
  }
}
// a message to the client
const toClient = (m: JSONRPCMessage) => {
  if ('method' in m && m.method === 'elicitation/create' && 'id' in m) {
    elicited.set(m.id, record.elicitations.length)
    record.elicitations.push({
      message: String((m.params as { message?: unknown })?.message ?? ''),
      at: Date.now(),
    })
    save()
    return
  }
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
      fromClient(m)
      this.onmessage?.(m)
    }
    // oxlint-disable-next-line unicorn/prefer-add-event-listener
    this.inner.onclose = () => this.onclose?.()
    // oxlint-disable-next-line unicorn/prefer-add-event-listener
    this.inner.onerror = (e) => this.onerror?.(e)
    await this.inner.start()
  }
  async send(m: JSONRPCMessage) {
    toClient(m)
    await this.inner.send(m)
  }
  async close() {
    await this.inner.close()
  }
}

// the trial session on every request: a bearer, which the Origin rule exempts, as Node's fetch has no cookie to send
const withSession: typeof fetch = (input, init = {}) => {
  const headers = new Headers(init.headers)
  headers.set('authorization', `Bearer ${config.session}`)
  return fetch(input, { ...init, headers })
}
await createMcpServer({
  adapter: httpAdapter(`${config.url}/api/projection`, withSession, {
    policy: 'exhaustive',
    start: { type: 'hosting.project', key: config.project },
  }),
  // the public manifest the trial's server serves, with its task's claim edit
  manifest: lab.manifestFor(config.task, lab.manifest),
  mode: 'generic',
}).connect(new Recording())

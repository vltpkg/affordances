import type { CapabilityManifest } from '@affordances/ir'
import { createToolset, type AgentAdapter, type Confirm } from '@affordances/runtime/agent'
import {
  createRuntimeAdapter,
  type RuntimeAdapterOptions,
} from '@affordances/runtime/agent-runtime'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

// RFC 0004 §4: version 1's capabilities over MCP. The tools, and the boundary every result passes on its way to the
// model, are @affordances/runtime/agent's, shared with WebMCP (intake, 2026-11-18 13:43Z): this is MCP's adapter
// only. Its tool list and calls map onto the toolset's, over an in-process runtime, and the person confirms through
// MCP's elicitation

/** @experimental What createMcpServer takes: the in-process adapter's options, for one principal, and MCP's own. */
export type McpServerOptions = Omit<RuntimeAdapterOptions, 'caller'> & {
  mode?: 'generic' | 'per-capability'
  // how long the person has to answer a confirmation before it counts as declined
  elicitTimeoutMs?: number
}

/**
 * @experimental The same server over another adapter: protocol 1 over HTTP to the app's own server, for example, in
 * place of an in-process runtime. The tools, the boundary and the confirmation through elicitation are the same; the
 * manifest gives the per-capability mode its tool list.
 */
export type McpAdapterOptions = {
  adapter: AgentAdapter
  manifest: CapabilityManifest
  mode?: 'generic' | 'per-capability'
  elicitTimeoutMs?: number
}

/** @experimental An MCP server for one connection over the app's capabilities (RFC 0004 §4). */
export const createMcpServer = (options: McpServerOptions | McpAdapterOptions) => {
  const { mode, elicitTimeoutMs } = options
  // the in-process adapter reads only its own options, so MCP's two pass through it unread
  const adapter =
    'adapter' in options
      ? options.adapter
      : createRuntimeAdapter({ ...options, caller: 'createMcpServer' })
  const toolset = createToolset({ adapter, mode, manifest: options.manifest })
  const server = new Server(
    { name: 'affordances-v1', version: '0.0.0' },
    // no instructions: they'd be prompt text outside every view (M7f's PLAN)
    { capabilities: { tools: {} } },
  )
  // the person's answer, through MCP's elicitation, when the client can ask; exactly the summary the token binds
  const confirm = (): Confirm | undefined =>
    server.getClientCapabilities()?.elicitation
      ? async (summary) => {
          const answer = await server.elicitInput(
            { message: summary, requestedSchema: { type: 'object', properties: {} } },
            { timeout: elicitTimeoutMs ?? 300_000 },
          )
          return answer.action
        }
      : undefined
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolset.tools }))
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) =>
    toolset.call(params.name, (params.arguments ?? {}) as Record<string, unknown>, confirm()),
  )
  return server
}

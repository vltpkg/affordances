// RFC 0004 §5: version 1's capabilities over WebMCP. The page registers the tools, which run in the person's browser
// and reach the runtime over protocol 1's HTTP endpoints, with the person's own session: the runtime, its resolvers
// and its approval key stay on the server. Every result passes the runtime's one boundary (toModel), so no tool
// channel ever yields an approval. Confirmation fails closed: in-tool consent only where the browser offers
// requestUserInteraction, and otherwise the refusal, for the person to confirm in the app itself (intake, 2026-11-18)
import {
  createToolset,
  httpAdapter,
  type AgentToolResult,
  type Confirm,
  type ViewRequest,
} from '@affordances/runtime/agent'

// protocol 1 over fetch lives in the runtime's agent core, shared with MCP's adapter; the page's API is unchanged
export { httpAdapter, type ViewRequest } from '@affordances/runtime/agent'

type CapabilityManifest = NonNullable<Parameters<typeof createToolset>[0]['manifest']>

// what WebMCP gives a tool's execute as its second argument, where a browser offers in-tool consent
type ToolClient = {
  requestUserInteraction?: (ask: () => Promise<unknown>) => Promise<unknown>
}

// the page's own consent prompt, run inside the browser's user interaction: true only on the person's accept
export type AskPerson = (summary: string) => Promise<boolean>

/**
 * In-tool consent, only where the browser offers it (feature-detected): `requestUserInteraction` on the tool's client.
 * Without it, there's no confirm, and the toolset returns the refusal with no token and no way to approve: the
 * person confirms in the app's own review-and-confirm step (RFC 0004 §5, as amended).
 */
export const confirmFor = (client: unknown, ask: AskPerson): Confirm | undefined => {
  const request = (client as ToolClient | null | undefined)?.requestUserInteraction
  if (typeof request !== 'function') return undefined
  return async (summary) => {
    const accepted = await request.call(client, () => ask(summary))
    return accepted === true ? 'accept' : 'decline'
  }
}

// WebMCP's page API, as Chromium has it (rfcs/research/0004-webmcp/SPIKE.md): document.modelContext, then the older
// navigator.modelContext
type ModelContext = {
  registerTool(tool: {
    name: string
    description: string
    inputSchema: Record<string, unknown>
    annotations?: Record<string, unknown>
    execute: (args: Record<string, unknown>, client?: unknown) => Promise<AgentToolResult>
  }): unknown
  unregisterTool?: (name: string) => unknown
}

/** @experimental The page's WebMCP context, or undefined where the browser has none. */
export const modelContext = (): ModelContext | undefined => {
  const g = globalThis as {
    document?: { modelContext?: ModelContext }
    navigator?: { modelContext?: ModelContext }
  }
  return g.document?.modelContext ?? g.navigator?.modelContext
}

/** @experimental What registerWebMcp takes. */
export type WebMcpOptions = {
  // the projection route's path, which the site index names as base (RFC 0004 §2)
  base: string
  // generic by default (RFC 0004 §5, as amended); per-capability lists its tools from the public manifest
  mode?: 'generic' | 'per-capability'
  manifest?: CapabilityManifest
  // the page's consent prompt, used only where the browser offers requestUserInteraction
  ask: AskPerson
  // the view request every call carries: the policy (the route's default without one)
  view?: ViewRequest
  // the resource the page is about, as the projection's start when the agent's project names none (intake,
  // 2026-11-18): a view parameter only, which grants nothing. Without it, the first view is site-wide
  start?: ViewRequest['start']
  context?: ModelContext
  fetcher?: typeof fetch
}

/**
 * @experimental Registers version 1's tools on the page's WebMCP context, and returns their names. Where the browser
 * has no WebMCP, it registers nothing and returns [].
 */
export const registerWebMcp = (options: WebMcpOptions): string[] => {
  const context = options.context ?? modelContext()
  if (!context) return []
  // the page's start rides in the view request, where the adapter keeps it for any project() that names none
  const view = { ...options.view, ...(options.start !== undefined && { start: options.start }) }
  const toolset = createToolset({
    adapter: httpAdapter(options.base, options.fetcher, view),
    mode: options.mode ?? 'generic',
    ...(options.manifest && { manifest: options.manifest }),
  })
  for (const tool of toolset.tools)
    context.registerTool({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      ...(tool.annotations && { annotations: tool.annotations }),
      execute: (args, client) => toolset.call(tool.name, args, confirmFor(client, options.ask)),
    })
  return toolset.tools.map((t) => t.name)
}

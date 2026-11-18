import { canonicalJson, renderConfirmation, type CapabilityManifest } from '@affordances/ir'
import type { ExecutionResult, OfferDetails, ProjectionRequest, View } from './types.ts'

// RFC 0004 §3 and §4's agent tools, transport-free and browser-safe (intake, 2026-11-18 13:43Z; design's split): the
// generic mode's four tools, the per-capability mode's tools, and the one boundary every result passes on its way to
// the model. A transport (MCP, WebMCP) maps its own tool calls onto call(), and brings two things: an adapter that
// reaches the capabilities (in process: ./agent-runtime; in a browser, the HTTP endpoints of RFC 0004 §2), and how to
// ask the person to confirm. This module imports ir and runtime's types only: no transport's SDK, no runtime, no key,
// so a browser bundles it, and every transport has the same guarantee: the model never holds an approval token

/** @experimental A tool as an agent sees it: plain JSON Schema input, and MCP's four hints. */
export type AgentTool = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  annotations?: {
    readOnlyHint?: boolean
    idempotentHint?: boolean
    destructiveHint?: boolean
    openWorldHint?: boolean
  }
}
/** @experimental A tool's result as the model receives it: text only, never a token. */
export type AgentToolResult = { isError?: true; content: { type: 'text'; text: string }[] }
/**
 * @experimental How a transport asks the person to approve exactly this summary (RFC 0004 §4): only 'accept' runs the
 * call. Undefined when the transport can't ask, and the model then gets the refusal and summary, never a token.
 */
export type Confirm = (summary: string) => Promise<'accept' | 'decline' | 'cancel' | 'timeout'>

/**
 * @experimental What a toolset reaches the capabilities through, for one connection: in process, a runtime
 * (./agent-runtime); in a browser, the HTTP endpoints (RFC 0004 §2), with the person's own session. execute returns
 * the runtime's result whole, token included: the core keeps it, and only toModel's output leaves
 */
export type AgentAdapter = {
  // a fresh view, from a start or the connection's own; later expand and inspect calls read the same projection
  project(start?: ProjectionRequest['start']): Promise<View>
  expand(args: Record<string, unknown>): Promise<View>
  inspect(offer: string): Promise<OfferDetails>
  execute(call: { offer: string; input?: unknown; approval?: string }): Promise<ExecutionResult>
}

/** @experimental What createToolset takes: the adapter, and for the per-capability mode, the public manifest. */
export type ToolsetOptions = {
  adapter: AgentAdapter
  mode?: 'generic' | 'per-capability'
  // the per-capability mode's tool list comes from the manifest, which is public (RFC 0004 §2)
  manifest?: CapabilityManifest
}

// THE BOUNDARY (the planner, after review of 3a02e2c8): everything a tool returns reaches the model only through
// toModel. RFC 0004 §4 gives the person, never the model, the approval token: so every `approval` field, at any depth,
// is removed, and any text shaped like a token (the runtime's expiresAt~nonce~mac) is replaced. One function, not one
// check per path, so a new path can't forget it. RFC 8785's order, so a result's bytes are the same on every transport
/** @experimental The runtime's approval token's shape: `${expiresAt}~${nonce}~${mac}`. */
export const TOKEN = /[^\s"~]+~[A-Za-z0-9_-]+~[A-Za-z0-9_-]{16,}/g
const strip = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(strip)
    : value !== null && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value).flatMap(([k, v]) => (k === 'approval' ? [] : [[k, strip(v)]])),
        )
      : typeof value === 'string'
        ? value.replace(TOKEN, '[withheld]')
        : value
/** @experimental A tool's result as the model may see it: never a token. */
export const toModel = (value: unknown, error?: true): AgentToolResult => ({
  ...(error && { isError: true as const }),
  content: [
    {
      type: 'text' as const,
      text: typeof value === 'string' ? (strip(value) as string) : canonicalJson(strip(value)),
    },
  ],
})
const failure = (message: string) => toModel(message, true)

// a refusal as the model may see it: never the token, which only the person's answer may spend
const withoutToken = (result: ExecutionResult) => {
  if (result.status !== 'refused' || !result.confirmation?.approval) return result
  const { approval: _, ...confirmation } = result.confirmation
  return { ...result, confirmation }
}

// RFC 0004 §3's four tools, as the benchmark measured them. execute takes no approval: the person is asked
const ref = {
  type: 'object',
  properties: { type: { type: 'string' }, key: { type: 'string' } },
  required: ['type', 'key'],
}
/** @experimental The generic mode's four tools (RFC 0004 §3), the same for every connection. */
export const GENERIC_TOOLS: AgentTool[] = [
  {
    name: 'project',
    description: 'See the actions available to you, and the options among them.',
    inputSchema: { type: 'object', properties: { start: ref } },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'expand',
    description:
      'See more of what a view counted but didn’t show: pass one of its omitted.expand entries’ from and along.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { anyOf: [{ type: 'string' }, ref] },
        along: {
          type: 'string',
          enum: [
            'alternatives',
            'members',
            'relations',
            'contains',
            'enables',
            'more',
            'comparison',
          ],
        },
      },
      required: ['from', 'along'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'inspect',
    description: 'See one offer in full: its definition, conditions, effects and claims.',
    inputSchema: { type: 'object', properties: { offer: { type: 'string' } }, required: ['offer'] },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'execute',
    description:
      // transport-neutral (design's M7d measurement): over MCP the person is asked by elicitation; on WebMCP no browser
      // can ask yet, so the call is refused and the person confirms in the app
      'Do an offer’s action. If it needs the user’s approval, it runs only once they approve it; otherwise this returns the refusal, with its summary for them.',
    inputSchema: {
      type: 'object',
      properties: { offer: { type: 'string' }, input: { type: 'object' } },
      required: ['offer'],
    },
  },
]

type Capability = CapabilityManifest['capabilities'][number]

/** @experimental RFC 0004 §4's per-capability tool: its id, its description with its charges, its input, four hints. */
export const capabilityTool = (c: Capability): AgentTool => {
  const charges = /Charges: (.*)$/.exec(renderConfirmation('', c.effects, {}))?.[1]
  const effects = c.effects ?? []
  return {
    name: c.id,
    description: charges ? `${c.description} Charges: ${charges}.` : c.description,
    inputSchema: { type: 'object', ...(c.input as object | undefined) },
    annotations: {
      readOnlyHint: c.safe === true,
      ...(c.idempotent !== undefined && { idempotentHint: c.idempotent }),
      destructiveHint: effects.some((e) => e.reversibility === 'irreversible'),
      openWorldHint: effects.some((e) => e.category === 'external'),
    },
  }
}
/** @experimental What the per-capability mode exports: availability that doesn't depend on who's asking. */
export const exportable = (m: CapabilityManifest) =>
  m.capabilities.filter((c) => c.kind !== 'event' && c.authorization?.principal === 'any')

/** @experimental The agent tools for one connection, over an adapter, for any transport (RFC 0004 §3, §4). */
export const createToolset = (options: ToolsetOptions) => {
  const { adapter } = options
  const mode = options.mode ?? 'generic'
  if (mode === 'per-capability' && !options.manifest)
    throw new TypeError('the per-capability mode lists its tools from the manifest: pass manifest')

  // execute, and on confirmation_required, the person's answer: only an explicit accept spends the token, which never
  // leaves this function
  const execute = async (offer: string, input: unknown, confirm: Confirm | undefined) => {
    const result = await adapter.execute({ offer, input })
    if (result.status !== 'refused' || result.code !== 'confirmation_required')
      return withoutToken(result)
    const summary = result.confirmation?.summary ?? ''
    const token = result.confirmation?.approval
    if (!token || !confirm) return withoutToken(result)
    // exactly the summary the token binds, charges included
    const answer = await confirm(summary).catch(() => 'timeout' as const)
    if (answer !== 'accept') return { ...withoutToken(result), answered: answer }
    // the run with the person's token. Whatever comes back is stripped too: a refusal here (the token spent, the
    // offer's revision moved) can carry a fresh token, which the model must never see (review of 3a02e2c8)
    return withoutToken(await adapter.execute({ offer, input, approval: token }))
  }

  const tools =
    mode === 'generic' ? GENERIC_TOOLS : exportable(options.manifest!).map(capabilityTool)
  // every tool call, through the boundary
  const call = async (
    name: string,
    args: Record<string, unknown> = {},
    confirm?: Confirm,
  ): Promise<AgentToolResult> => {
    try {
      if (mode === 'per-capability') {
        if (!tools.some((t) => t.name === name)) return failure(`no tool ${name}`)
        // a capability id stands for its offer, with the target's key in the input (RFC 0002 §8.1)
        return toModel(await execute(name, args, confirm))
      }
      switch (name) {
        case 'project':
          return toModel(await adapter.project(args.start as ProjectionRequest['start']))
        case 'expand':
          return toModel(await adapter.expand(args))
        case 'inspect':
          return toModel(await adapter.inspect(String(args.offer)))
        case 'execute':
          return toModel(await execute(String(args.offer), args.input, confirm))
        default:
          return failure(`no tool ${name}`)
      }
    } catch (error) {
      return failure((error as Error).message)
    }
  }
  return { tools, call }
}

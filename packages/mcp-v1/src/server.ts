import { canonicalJson, renderConfirmation, type CapabilityManifest } from '@affordances/ir'
import {
  createRuntime,
  type ExecutionResult,
  type Handler,
  type Principal,
  type Projection,
  type ProjectionRequest,
  type ResourceResolver,
  type TokenStore,
} from '@affordances/runtime'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js'

// RFC 0004 §4: version 1's capabilities over MCP. The generic mode is RFC 0004 §3's four tools, the same for every
// connection, since a projection varies per principal and MCP's tool list can't; the view carries what this caller can
// do. The per-capability mode is one tool per capability whose authorization is 'any', named by its id. In both,
// confirmation goes to the person through elicitation, and the model never holds an approval token

/** @experimental What createMcpServer takes: the app's manifest and resolvers, as a runtime does, for one principal. */
export type McpServerOptions = {
  manifest: CapabilityManifest
  resources: Record<string, ResourceResolver>
  handlers?: Record<string, Handler>
  // the connection's caller: an MCP server serves one connection, so one principal
  principal: Principal
  // the projection request's other parts, the same on every call: a policy, a start, a task
  request?: Omit<ProjectionRequest, 'principal'>
  mode?: 'generic' | 'per-capability'
  // approval tokens (RFC 0002 §8.2): required unless NODE_ENV is development or test, as the projection route's are
  approvalKey?: CryptoKey
  seenTokens?: TokenStore
  // how long the person has to answer a confirmation before it counts as declined
  elicitTimeoutMs?: number
}

// RFC 8785's order, so a result's bytes are the same wherever it's rendered (RFC 0004 §3)
const text = (value: unknown) => ({
  content: [{ type: 'text' as const, text: canonicalJson(value) }],
})
const failure = (message: string) => ({
  isError: true,
  content: [{ type: 'text' as const, text: message }],
})

// a refusal as the model may see it: never the token, which only the person's answer may spend
const withoutToken = (result: ExecutionResult) => {
  if (result.status !== 'refused' || !result.confirmation?.approval) return result
  const { approval: _, ...confirmation } = result.confirmation
  return { ...result, confirmation }
}

// RFC 0004 §3's four tools, as the benchmark measured them. execute takes no approval: the server asks the person
const ref = {
  type: 'object',
  properties: { type: { type: 'string' }, key: { type: 'string' } },
  required: ['type', 'key'],
}
const GENERIC: Tool[] = [
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
      'Do an offer’s action. If it needs the user’s approval, the server asks them directly and runs it only if they accept.',
    inputSchema: {
      type: 'object',
      properties: { offer: { type: 'string' }, input: { type: 'object' } },
      required: ['offer'],
    },
  },
]

type Capability = CapabilityManifest['capabilities'][number]

// RFC 0004 §4's per-capability tool: its id, its description with its charges, its input, and MCP's four booleans
export const capabilityTool = (c: Capability): Tool => {
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
// what the per-capability mode exports: availability that doesn't depend on who's asking
export const exportable = (m: CapabilityManifest) =>
  m.capabilities.filter((c) => c.kind !== 'event' && c.authorization?.principal === 'any')

/** @experimental An MCP server for one connection over the app's capabilities (RFC 0004 §4). */
export const createMcpServer = (options: McpServerOptions) => {
  // the same fail-closed gate as the projection route (review of b96dee48): per-process defaults are a replay across
  // instances, so only development and test, named, get them
  const env = process.env.NODE_ENV
  if (env !== 'development' && env !== 'test') {
    const missing = [
      !options.approvalKey && 'approvalKey',
      !options.seenTokens && 'seenTokens',
    ].filter(Boolean)
    if (missing.length)
      throw new Error(
        `createMcpServer needs ${missing.join(' and ')} unless NODE_ENV is development or test: an HMAC approvalKey ` +
          'shared by every instance, and a seenTokens store every instance shares, whose claim(nonce, expiresAt) is single-use',
      )
  }
  const mode = options.mode ?? 'generic'
  const seen = new Map<string, number>()
  const runtime = (async () =>
    createRuntime({
      manifest: options.manifest,
      resources: options.resources,
      handlers: options.handlers,
      approvalKeys: {
        current:
          options.approvalKey ??
          ((await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, [
            'sign',
            'verify',
          ])) as CryptoKey),
      },
      seenTokens: options.seenTokens ?? {
        claim: async (nonce, expiresAt) => {
          const now = Date.now()
          for (const [n, until] of seen) if (until <= now) seen.delete(n)
          if (seen.has(nonce)) return false
          seen.set(nonce, expiresAt.getTime())
          return true
        },
      },
    }))()

  const server = new Server(
    { name: 'affordances-v1', version: '0.0.0' },
    // no instructions: they'd be prompt text outside every view (M7f's PLAN)
    { capabilities: { tools: {} } },
  )
  const request = (start?: unknown): ProjectionRequest => ({
    ...options.request,
    principal: options.principal,
    ...(start !== undefined && { start: start as ProjectionRequest['start'] }),
  })
  // the projection the last project call made: expand and inspect read it, as the benchmark's tools do
  let latest: Promise<Projection> | undefined
  const current = async () => (latest ??= (await runtime).project(request()))

  // execute, and on confirmation_required, the person's answer: only an explicit accept spends the token
  const execute = async (offer: string, input: unknown) => {
    const rt = await runtime
    const call = {
      principal: options.principal,
      offer,
      input,
      view: { ...options.request },
    } as never
    const result = await rt.execute(call)
    if (result.status !== 'refused' || result.code !== 'confirmation_required')
      return withoutToken(result)
    const summary = result.confirmation?.summary ?? ''
    const token = result.confirmation?.approval
    if (!token || !server.getClientCapabilities()?.elicitation) return withoutToken(result)
    try {
      const answer = await server.elicitInput(
        // exactly the summary the token binds, charges included
        { message: summary, requestedSchema: { type: 'object', properties: {} } },
        { timeout: options.elicitTimeoutMs ?? 300_000 },
      )
      if (answer.action !== 'accept') return { ...withoutToken(result), answered: answer.action }
    } catch {
      return { ...withoutToken(result), answered: 'timeout' }
    }
    // the run with the person's token. Whatever comes back is stripped too: a refusal here (the token spent, the
    // offer's revision moved) can carry a fresh token, which the model must never see (review of 3a02e2c8)
    return withoutToken(await rt.execute({ ...(call as object), approval: token } as never))
  }

  const tools = mode === 'generic' ? GENERIC : exportable(options.manifest).map(capabilityTool)
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    const args = (params.arguments ?? {}) as Record<string, unknown>
    try {
      if (mode === 'per-capability') {
        if (!tools.some((t) => t.name === params.name)) return failure(`no tool ${params.name}`)
        // a capability id stands for its offer, with the target's key in the input (RFC 0002 §8.1)
        return text(await execute(params.name, args))
      }
      switch (params.name) {
        case 'project':
          latest = (await runtime).project(request(args.start))
          return text((await latest).view())
        case 'expand':
          return text(await (await current()).expand(args as never))
        case 'inspect':
          return text(await (await current()).inspect(String(args.offer)))
        case 'execute':
          return text(await execute(String(args.offer), args.input))
        default:
          return failure(`no tool ${params.name}`)
      }
    } catch (error) {
      return failure((error as Error).message)
    }
  })
  return server
}

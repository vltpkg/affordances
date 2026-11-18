import type { CapabilityManifest } from '@affordances/ir'
import type { AgentAdapter } from './agent.ts'
import { createRuntime } from './project.ts'
import type {
  Handler,
  Principal,
  Projection,
  ProjectionRequest,
  ResourceResolver,
  TokenStore,
} from './types.ts'

// the agent tools' adapter in process: a runtime built from the app's manifest, resolvers and handlers, for one
// principal, with the approval key and the single-use store. Server-side only, since it holds all of them; a browser
// reaches the same capabilities over HTTP instead (RFC 0004 §2)

/** @experimental What a runtime adapter takes, for one connection's principal. */
export type RuntimeAdapterOptions = {
  manifest: CapabilityManifest
  resources: Record<string, ResourceResolver>
  handlers?: Record<string, Handler>
  principal: Principal
  // the projection request's other parts, the same on every call: a policy, a start, a task
  request?: Omit<ProjectionRequest, 'principal'>
  // approval tokens (RFC 0002 §8.2): required unless NODE_ENV is development or test, as the projection route's are
  approvalKey?: CryptoKey
  seenTokens?: TokenStore
  // the runtime's approval expiry and clock (RFC 0002 §8.2), passed through
  approvalTtlMs?: number
  now?: () => number
  // who's asking, for the gate's message: the transport's own constructor
  caller?: string
}

/** @experimental The agent tools' adapter over an in-process runtime (RFC 0004 §4). */
export const createRuntimeAdapter = (options: RuntimeAdapterOptions): AgentAdapter => {
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
        `${options.caller ?? 'createRuntimeAdapter'} needs ${missing.join(' and ')} unless NODE_ENV is development or test: an HMAC approvalKey ` +
          'shared by every instance, and a seenTokens store every instance shares, whose claim(nonce, expiresAt) is single-use',
      )
  }
  const seen = new Map<string, number>()
  const runtime = (async () =>
    createRuntime({
      manifest: options.manifest,
      resources: options.resources,
      handlers: options.handlers,
      ...(options.approvalTtlMs !== undefined && { approvalTtlMs: options.approvalTtlMs }),
      ...(options.now && { now: options.now }),
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
  const request = (start?: ProjectionRequest['start']): ProjectionRequest => ({
    ...options.request,
    principal: options.principal,
    ...(start !== undefined && { start }),
  })
  // the projection the last project call made: expand and inspect read it, as the benchmark's tools do. Its start is
  // the one an execution's changes are compared from, as httpAdapter sends it (code review of M8, #6)
  let latest: Promise<Projection> | undefined
  let start: ProjectionRequest['start']
  const current = async () => (latest ??= (await runtime).project(request()))
  return {
    project: async (next) => {
      start = next
      latest = (await runtime).project(request(start))
      return (await latest).view()
    },
    expand: async (args) => (await current()).expand(args as never),
    inspect: async (offer) => (await current()).inspect(offer),
    execute: async ({ offer, input, approval }) =>
      (await runtime).execute({
        principal: options.principal,
        offer,
        input,
        ...(approval !== undefined && { approval }),
        view: { ...options.request, ...(start !== undefined && { start }) },
      } as never),
  }
}

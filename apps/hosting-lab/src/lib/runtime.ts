import type { CapabilityManifest } from '@affordances/ir'
import { createRuntime, type TokenStore } from '@affordances/runtime'
import { manifest } from '../app/capabilities.ts'
import { handlers, memoryTokens } from './handlers.ts'
import { principalFor, resolvers } from './resolvers.ts'

// the app's projection runtime, over its in-memory store. Its approval key is made per process, as the store is,
// so a token from an earlier process never verifies. Both are on globalThis, like the store (src/lib/store.ts), so
// every route bundle signs and spends tokens alike

const shared = globalThis as { hostingLabApprovals?: { key: CryptoKey; seen: TokenStore } }
const approvals = (shared.hostingLabApprovals ??= {
  key: (await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ])) as CryptoKey,
  seen: memoryTokens(),
})

// one runtime per manifest: createRuntime finds a manifest's facts once (derive, edges, schemas), so it's built once
const runtimes = new WeakMap<CapabilityManifest, ReturnType<typeof createRuntime>>()
export const runtimeFor = (m: CapabilityManifest) => {
  let made = runtimes.get(m)
  if (!made) {
    made = createRuntime({
      manifest: m,
      resources: resolvers,
      handlers,
      approvalKeys: { current: approvals.key },
      seenTokens: approvals.seen,
    })
    runtimes.set(m, made)
  }
  return made
}

export const runtime = runtimeFor(manifest)

// what a v0 action needs to have the runtime check its capability on the agent path (RFC 0001 §12.1)
export const checkedBy = {
  runtime,
  principal: (ctx: { session: { id: string } | null }) => principalFor(ctx.session?.id ?? null),
}

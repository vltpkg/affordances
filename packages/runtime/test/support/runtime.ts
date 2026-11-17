import { createRuntime, type RuntimeOptions } from '../../src/index.ts'
import type { Handler, TokenStore } from '../../src/index.ts'

// what every runtime in these tests shares: an approval key and a token store in memory, as one process needs
// (§8.2), and a handler that runs each query and action the test doesn't give one (§11)
const seen = new Set<string>()
export const memoryTokens: TokenStore = {
  claim: async (nonce) => (seen.has(nonce) ? false : (seen.add(nonce), true)),
}
export const approvalKeys = {
  current: await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]),
}

export const testRuntime = (options: RuntimeOptions) => {
  const handlers: Record<string, Handler> = { ...options.handlers }
  for (const c of options.manifest.capabilities)
    if (c.kind !== 'event') handlers[c.id] = { run: () => undefined, ...handlers[c.id] }
  return createRuntime({ approvalKeys, seenTokens: memoryTokens, ...options, handlers })
}

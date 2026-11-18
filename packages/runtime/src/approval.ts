import type { TokenStore } from './types.ts'

// the approval token's two server-side parts (RFC 0002 §8.2), and the one gate every host keeps. next's projection
// route keeps a copy of the gate, since it loads the runtime only on its first request, and a test holds them equal

/** @experimental A single-use store in memory: each nonce until its token expires, then dropped, so it never grows. */
export const memoryTokenStore = (): TokenStore => {
  const seen = new Map<string, number>()
  return {
    claim: async (nonce, expiresAt) => {
      const now = Date.now()
      for (const [n, until] of seen) if (until <= now) seen.delete(n)
      if (seen.has(nonce)) return false
      seen.set(nonce, expiresAt.getTime())
      return true
    },
  }
}

/** @experimental A per-process HMAC key for approval tokens, for development, tests and single-process apps. */
export const devApprovalKey = async (): Promise<CryptoKey> =>
  (await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ])) as CryptoKey

/**
 * @experimental The production gate: deployed, per-process defaults are a replay, since each instance would run a
 * token once and one instance's token would fail on another. So outside NODE_ENV development or test, named, both are
 * required, and it fails closed: an unset NODE_ENV, as a plain node server has, isn't development.
 */
export const approvalGate = (
  caller: string,
  given: { approvalKey?: unknown; seenTokens?: unknown },
) => {
  const env = process.env.NODE_ENV
  if (env === 'development' || env === 'test') return
  const missing = [!given.approvalKey && 'approvalKey', !given.seenTokens && 'seenTokens'].filter(
    Boolean,
  )
  if (missing.length)
    throw new Error(
      `${caller} needs ${missing.join(' and ')} unless NODE_ENV is development or test: an HMAC approvalKey ` +
        'shared by every instance, and a seenTokens store every instance shares, whose claim(nonce, expiresAt) is ' +
        'single-use, such as a database or KV with a TTL of at least the approval expiry',
    )
}

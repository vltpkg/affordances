import { afterEach, expect, test, vi } from 'vitest'
import { approvalGate, devApprovalKey, memoryTokenStore } from '../src/approval.ts'

// the approval token's defaults and the one gate every host keeps (RFC 0002 §8.2)

afterEach(() => vi.unstubAllEnvs())

test('the gate passes in development and test, and outside them names what is missing, failing closed', async () => {
  const key = await devApprovalKey()
  const store = memoryTokenStore()
  for (const env of ['development', 'test']) {
    vi.stubEnv('NODE_ENV', env)
    expect(() => approvalGate('host', {})).not.toThrow()
  }
  for (const env of ['production', '']) {
    vi.stubEnv('NODE_ENV', env)
    expect(() => approvalGate('host', {})).toThrow(
      /^host needs approvalKey and seenTokens unless NODE_ENV is development or test/,
    )
    expect(() => approvalGate('host', { approvalKey: key })).toThrow(/^host needs seenTokens /)
    expect(() => approvalGate('host', { seenTokens: store })).toThrow(/^host needs approvalKey /)
    expect(() => approvalGate('host', { approvalKey: key, seenTokens: store })).not.toThrow()
  }
})

test('the memory store claims a nonce once, and forgets it once its token has expired', async () => {
  const store = memoryTokenStore()
  const later = new Date(Date.now() + 60_000)
  expect(await store.claim('n1', later)).toBe(true)
  expect(await store.claim('n1', later)).toBe(false)
  expect(await store.claim('n2', new Date(Date.now() - 1))).toBe(true)
  // n2 expired, so the next claim drops it, and it can be claimed again
  expect(await store.claim('n2', later)).toBe(true)
})

test('a dev key signs and verifies, and is never extractable', async () => {
  const key = await devApprovalKey()
  expect(key.extractable).toBe(false)
  const data = new TextEncoder().encode('call')
  const mac = await crypto.subtle.sign('HMAC', key, data)
  expect(await crypto.subtle.verify('HMAC', key, mac, data)).toBe(true)
})

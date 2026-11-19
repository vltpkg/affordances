import { NextRequest } from 'next/server'
import { afterEach, expect, test } from 'vitest'
import { inspectorEnabled } from '../src/lib/gate.ts'
import { proxy } from '../src/proxy.ts'

// the inspector is off unless HOSTING_LAB_INSPECTOR=1: a full projection is never on an agent-facing surface

afterEach(() => {
  delete process.env.HOSTING_LAB_INSPECTOR
})

test('off by default, on only for the exact value 1', () => {
  expect(inspectorEnabled({})).toBe(false)
  expect(inspectorEnabled({ HOSTING_LAB_INSPECTOR: 'true' })).toBe(false)
  expect(inspectorEnabled({ HOSTING_LAB_INSPECTOR: '1' })).toBe(true)
})

test('/inspect answers 404 unless the inspector is on, for any caller', async () => {
  const callers: Record<string, string>[] = [
    {},
    { authorization: 'Bearer s_1' },
    { cookie: 'sid=s_1' },
  ]
  for (const headers of callers) {
    const response = proxy(
      new NextRequest('https://hosting.test/inspect?policy=exhaustive', { headers }),
    )
    expect(response.status).toBe(404)
  }
  process.env.HOSTING_LAB_INSPECTOR = '1'
  expect(proxy(new NextRequest('https://hosting.test/inspect')).status).toBe(200)
})

test('the rest of the app is unaffected', () => {
  expect(proxy(new NextRequest('https://hosting.test/plans')).status).toBe(200)
})

test('nothing links to the inspector', async () => {
  const { readFileSync } = await import('node:fs')
  expect(readFileSync(new URL('../src/app/layout.tsx', import.meta.url), 'utf8')).not.toContain(
    '/inspect',
  )
})

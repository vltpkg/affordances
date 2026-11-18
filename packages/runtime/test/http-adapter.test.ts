import { expect, test } from 'vitest'
import { httpAdapter } from '../src/agent.ts'

// protocol 1 over fetch (RFC 0004 §2), moved from @affordances/webmcp. A host without a browser's cookie passes a
// fetcher that adds its session: what the wrapper adds reaches the request, and the adapter's own requests are as before

const recorder = () => {
  const seen: { url: string; method: string; headers: Record<string, string>; body?: string }[] = []
  const fetcher = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    seen.push({
      url: String(input),
      method: init.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      ...(typeof init.body === 'string' && { body: init.body }),
    })
    return new Response(JSON.stringify({ offers: [], status: 'succeeded' }), {
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
  return { seen, fetcher }
}

test('a wrapped fetcher’s session and Origin reach every request', async () => {
  const { seen, fetcher } = recorder()
  const withSession: typeof fetch = (input, init = {}) => {
    const headers = new Headers(init.headers)
    headers.set('authorization', 'Bearer s_1')
    headers.set('cookie', 'sid=s_1')
    headers.set('origin', 'http://127.0.0.1:3913')
    return fetcher(input, { ...init, headers })
  }
  const a = httpAdapter('http://127.0.0.1:3913/api/projection', withSession, {
    policy: 'exhaustive',
  })
  await a.project({ type: 'hosting.project', key: 'j1' })
  await a.execute({ offer: 'o1', input: { plan: 'p2' } })
  for (const r of seen)
    expect(r.headers).toMatchObject({
      authorization: 'Bearer s_1',
      cookie: 'sid=s_1',
      origin: 'http://127.0.0.1:3913',
    })
})

test('its requests: GET view with the start and policy, POST execute with the same, as webmcp sent them', async () => {
  const { seen, fetcher } = recorder()
  const a = httpAdapter('http://h/api/projection', fetcher, { policy: 'exhaustive' })
  await a.project({ type: 'hosting.project', key: 'j1' })
  await a.inspect('o1')
  await a.expand({ from: 'o1', along: 'alternatives' })
  await a.execute({ offer: 'o1', input: { plan: 'p2' } })
  expect(seen.map((r) => [r.method, r.url, r.body ?? null])).toEqual([
    ['GET', 'http://h/api/projection/view?policy=exhaustive&start=hosting.project%3Aj1', null],
    [
      'GET',
      'http://h/api/projection/inspect?offer=o1&policy=exhaustive&start=hosting.project%3Aj1',
      null,
    ],
    [
      'POST',
      'http://h/api/projection/expand',
      JSON.stringify({
        from: 'o1',
        along: 'alternatives',
        policy: 'exhaustive',
        start: 'hosting.project:j1',
      }),
    ],
    [
      'POST',
      'http://h/api/projection/execute',
      JSON.stringify({
        offer: 'o1',
        input: { plan: 'p2' },
        policy: 'exhaustive',
        start: 'hosting.project:j1',
      }),
    ],
  ])
})

import { expect, test } from 'vitest'
import { serveCheck, serveView } from '../src/lib/serve.ts'
import * as store from '../src/lib/store.ts'

// M7d: hosting-lab serves RFC 0004 §2's protocol 1 under /api/projection, through next's projection route, so design's
// WebMCP (and any protocol-1 client) reaches it at {base}/view and {base}/check as well as expand, inspect and execute

const base = 'https://hosting.test/api/projection'
const bearer = (sid: string) => ({ authorization: `Bearer ${sid}` })

test('GET {base}/view is the caller’s view, as GET {base} is', async () => {
  const sid = 's_protocol_view'
  store.account(sid)
  const view = await serveView(
    new Request(`${base}/view?policy=exhaustive`, { headers: bearer(sid) }),
  )
  const plain = await serveView(new Request(`${base}?policy=exhaustive`, { headers: bearer(sid) }))
  expect([view.status, view.headers.get('cache-control')]).toEqual([200, 'private, no-store'])
  expect(await view.json()).toEqual(await plain.json())
})

test('POST {base}/check answers the runtime’s check, never with a token, and runs nothing', async () => {
  const sid = 's_protocol_check'
  const { id } = store.account(sid).project
  const r = await serveCheck(
    new Request(`${base}/check`, {
      method: 'POST',
      body: JSON.stringify({
        offer: `hosting.plan.subscribe@hosting.plan:p2?project=${id}`,
        input: { plan: 'p2', projectId: id },
      }),
      headers: { 'content-type': 'application/json', ...bearer(sid) },
    }),
  )
  const body = await r.text()
  expect([r.status, JSON.parse(body).code]).toEqual([409, 'confirmation_required'])
  expect(body).not.toMatch(/approval/)
  expect(store.account(sid).project.plan).toBe('hobby')
})

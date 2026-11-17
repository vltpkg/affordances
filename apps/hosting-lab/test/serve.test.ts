import { beforeEach, expect, test } from 'vitest'
import { serveView } from '../src/lib/serve.ts'
import * as store from '../src/lib/store.ts'

// the agent-facing projection route answers with a view, for the caller its credentials name, and nothing more

beforeEach(() => store.reset())

const get = (query = '', headers: Record<string, string> = {}) =>
  serveView(new Request(`https://hosting.test/api/projection${query}`, { headers }))

test('a caller with a bearer session gets a view of their own projection', async () => {
  const response = await get('', { authorization: 'Bearer s_view' })
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  const view = await response.json()
  expect(Object.keys(view).toSorted()).toEqual([
    'choiceSets',
    'offers',
    'omitted',
    'order',
    'policy',
    'revision',
  ])
  expect(view.offers.map((o: { id: string }) => o.id)).toContain(
    `hosting.project.read@hosting.project:${store.account('s_view').project.id}`,
  )
})

test("a caller never sees another session's project", async () => {
  const theirs = store.account('s_other').project.id
  const view = await (await get('', { authorization: 'Bearer s_mine' })).json()
  expect(JSON.stringify(view)).not.toContain(theirs)
})

test('without credentials, nothing per-project is offered, and subscribing needs authorization', async () => {
  const view = await (await get()).json()
  expect(
    view.offers.some((o: { target?: { type: string } }) => o.target?.type === 'hosting.project'),
  ).toBe(false)
  const subscribe = view.offers.find(
    (o: { capability: string }) => o.capability === 'hosting.plan.subscribe',
  )
  expect(subscribe.availability.status).toBe('needs-authorization')
})

test('a stale `seen` revision is marked, and the current one is not', async () => {
  const first = await (await get('', { authorization: 'Bearer s_seen' })).json()
  expect(
    (await (await get(`?seen=${first.revision}`, { authorization: 'Bearer s_seen' })).json()).stale,
  ).toBeUndefined()
  store.addAddOn('s_seen', store.account('s_seen').project.id, 'daily-backups')
  expect(
    (await (await get(`?seen=${first.revision}`, { authorization: 'Bearer s_seen' })).json()).stale,
  ).toBe(true)
})

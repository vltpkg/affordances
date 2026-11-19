import { createRuntimeAdapter } from '@affordances/runtime/agent-runtime'
import { httpAdapter, type AgentAdapter } from '@affordances/runtime/agent'
import { beforeEach, expect, test } from 'vitest'
import { manifest } from '../src/app/capabilities.ts'
import { handlers } from '../src/lib/handlers.ts'
import { principalOf } from '../src/lib/principal.ts'
import { resolvers } from '../src/lib/resolvers.ts'
import * as serve from '../src/lib/serve.ts'
import * as store from '../src/lib/store.ts'

// code review of M8 (#6): the in-process adapter and httpAdapter run the same calls the same way. An execution is
// compared against the view the last project() named, on both, so the same calls give the same changes

beforeEach(() => store.reset())

const SESSION = 's_transports'
const auth = { authorization: `Bearer ${SESSION}` }
const routes: Record<string, (r: Request) => Promise<Response>> = {
  view: serve.GET,
  inspect: serve.GET,
  expand: serve.POST,
  execute: serve.POST,
}
const overHttp = (): AgentAdapter =>
  httpAdapter('https://hosting.test/api/projection', (async (url: string, init?: RequestInit) =>
    routes[new URL(url).pathname.split('/').at(-1)!]!(
      new Request(url, { ...init, headers: { ...init?.headers, ...auth } }),
    )) as typeof fetch)
const inProcess = (): AgentAdapter =>
  createRuntimeAdapter({
    manifest,
    resources: resolvers,
    handlers,
    principal: principalOf(new Request('https://hosting.test/', { headers: auth })),
  })

// the same calls on a fresh store: a view from the project, then a subscription, confirmed
// the adapter is made once the account exists, as a connection is, and the project's random id is named PROJECT
const run = async (connect: () => AgentAdapter) => {
  store.reset()
  const id = store.account(SESSION).project.id
  const adapter = connect()
  await adapter.project({ type: 'hosting.project', key: id })
  const call = {
    offer: `hosting.plan.subscribe@hosting.plan:p2?project=${id}`,
    input: { plan: 'p2', projectId: id },
  }
  const first = (await adapter.execute(call)) as { confirmation?: { approval?: string } }
  const done = (await adapter.execute({ ...call, approval: first.confirmation!.approval })) as {
    status: string
    changes: unknown
  }
  return { ...done, changes: JSON.parse(JSON.stringify(done.changes).replaceAll(id, 'PROJECT')) }
}

test('the same calls give the same changes in process and over HTTP, from the last project()', async () => {
  const http = await run(overHttp)
  const local = await run(inProcess)
  expect(http.status).toBe('succeeded')
  expect(local.status).toBe('succeeded')
  expect(local.changes).toEqual(http.changes)
})

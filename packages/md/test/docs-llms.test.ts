import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createLlmsTxtHandler } from '../src/next/index.ts'
import { ROUTES_ENV } from '../src/next/routes.ts'

// llms.mdx's "Prose sections" example, as written, so it type-checks and says what the docs show

// app/llms.txt/route.ts
const GET = createLlmsTxtHandler({
  summary: 'Studio goods in small runs.',
  sections: (request, routes) => [
    {
      title: 'Ordering',
      intro: 'Orders ship in two days. See [shipping](/shipping) and [returns](/returns).',
    },
    { title: 'Pages', intro: 'Everything in the store.', pages: routes },
  ],
})

const site = 'https://acme.store'
beforeEach(() => {
  vi.stubEnv(ROUTES_ENV, JSON.stringify(['/', '/shipping', '/returns']))
  vi.stubGlobal('fetch', async (url: URL) =>
    new URL(url).pathname.startsWith('/.well-known')
      ? new Response('', { status: 404 })
      : new Response(
          '<html><head><title>Home</title></head><body><main><p>x</p></main></body></html>',
          {
            headers: { 'content-type': 'text/html' },
          },
        ),
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

test('the prose sections example reads as the docs show', async () => {
  const body = await (await GET(new Request(`${site}/llms.txt`))).text()
  expect(body).toContain(
    '## Ordering\n\nOrders ship in two days. See [shipping](https://acme.store/shipping.md) and ' +
      '[returns](https://acme.store/returns.md).\n\n## Pages\n\nEverything in the store.\n\n- [Home](https://acme.store/index.md)',
  )
})

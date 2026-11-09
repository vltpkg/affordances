import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createLlmsTxtHandler } from '../src/next/index.ts'
import { ALIASES_ENV, ROUTES_ENV } from '../src/next/routes.ts'

// prose in llms.txt: the intro under its title and an intro per section, each with its links resolved and pointed at
// their twins as a page's are, since an agent reads llms.txt away from the site
const site = 'https://shop.test'
const page = (title: string) =>
  `<html><head><title>${title}</title></head><body><main><p>x</p></main></body></html>`
beforeEach(() => {
  vi.stubEnv(ROUTES_ENV, JSON.stringify(['/guide', '/docs', '/post', '/package/[name]']))
  vi.stubGlobal('fetch', async (url: URL) =>
    new URL(url).pathname.startsWith('/.well-known')
      ? new Response('', { status: 404 })
      : new Response(page('Post'), { headers: { 'content-type': 'text/html' } }),
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})
const llms = async (options: Parameters<typeof createLlmsTxtHandler>[0]) =>
  (
    await createLlmsTxtHandler({ title: 'Shop', full: false, ...options })(
      new Request(`${site}/llms.txt`),
    )
  ).text()

const links =
  'See [the guide](/guide), [the docs](https://shop.test/docs), [GitHub](https://github.com/acme) and ' +
  '<https://shop.test/guide>.'
const twinned =
  'See [the guide](https://shop.test/guide.md), [the docs](https://shop.test/docs.md), ' +
  '[GitHub](https://github.com/acme) and [https://shop.test/guide](https://shop.test/guide.md).'

test("a section's intro is printed under its heading, before its pages, with its links twinned", async () => {
  const body = await llms({
    sections: () => [{ title: 'Posts', intro: links, pages: [{ url: '/post', title: 'Post' }] }],
  })
  expect(body).toContain(`## Posts\n\n${twinned}\n\n- [Post](${site}/post.md)`)
})

test('a section can be prose alone', async () => {
  const body = await llms({
    sections: () => [
      { title: 'Reading the results', intro: 'Lower is better. See [the guide](/guide).' },
      { title: 'Posts', pages: ['/post'] },
    ],
  })
  expect(body).toContain(
    `## Reading the results\n\nLower is better. See [the guide](${site}/guide.md).\n\n## Posts`,
  )
})

test("the top-level intro's links are twinned too, and one without relative links is as written", async () => {
  expect(await llms({ intro: links, sections: () => [] })).toContain(twinned)
  const plain = 'Use [GitHub](https://github.com/acme) for issues, or **email** us.'
  expect(await llms({ intro: plain, sections: () => [] })).toContain(`\n\n${plain}\n`)
})

test('an intro link to an aliased public URL is twinned at that URL', async () => {
  vi.stubEnv(ALIASES_ENV, JSON.stringify([['/p/:name', '/package/:name']]))
  const body = await llms({
    sections: () => [{ title: 'Start', intro: 'Try [express](/p/express).' }],
  })
  expect(body).toContain(`Try [express](${site}/p/express.md).`)
})

test('a section with neither intro nor pages is left out, as before', async () => {
  const body = await llms({ sections: () => [{ title: 'Empty', pages: [] }] })
  expect(body).not.toContain('## Empty')
})

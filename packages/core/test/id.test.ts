import { expect, test } from 'vitest'
import { z } from 'zod'
import { AFFORDANCES, createHandler, defineAction } from '../src/index.ts'

// RFC 0001 §10.1's migration form: a v0 action names its capability id. It changes nothing on v0's wire
const withId = defineAction({
  name: 'addToCart',
  id: 'commerce.cart.addItem',
  description: 'Add to the cart',
  input: z.object({}),
  expose: 'public',
  run: () => {},
})

test("the id is the action's metadata", () => {
  expect(withId[AFFORDANCES].id).toBe('commerce.cart.addItem')
})

test('the graph and the site index are unchanged by it', async () => {
  const handler = createHandler({ manifest: { routes: { '/': { actions: [withId] } } } })
  const ask = async (path: string) =>
    (await handler(
      new Request(`https://shop.test${path}`, {
        headers: { accept: 'application/vnd.affordances+json' },
      }),
    ).then((r) => r.json())) as Record<string, unknown>
  expect(JSON.stringify(await ask('/'))).not.toContain('commerce.cart.addItem')
  expect(JSON.stringify(await ask('/.well-known/affordances.json'))).not.toContain(
    'commerce.cart.addItem',
  )
})

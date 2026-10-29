import { createClient, type AffordancesClient } from '@affordances/mcp'

// the five tasks from PLAN.md §8, against apps/example's seed. setup runs on a fresh session as plain
// affordances calls; check reads that session afterwards. `oracle` is the scripted ideal, for --dry runs.

type Cart = { items: { sku: string; quantity: number }[] }

export type Task = {
  id: string
  prompt: string
  setup?: (client: AffordancesClient) => Promise<void>
  check: (client: AffordancesClient, answer: string) => Promise<boolean>
  oracle: (client: AffordancesClient) => Promise<string>
}

const cart = async (client: AffordancesClient) => (await client.open('/cart')).entities.cart as Cart
const quantity = async (client: AffordancesClient, sku: string) =>
  (await cart(client)).items.find((item) => item.sku === sku)?.quantity ?? 0
const orders = async (client: AffordancesClient) =>
  (await client.open('/account/orders')).entities.orders as {
    items: { name: string }[]
    total: string
  }[]

const add = (client: AffordancesClient, slug: string, sku: string, n = 1) =>
  client.call(`/products/${slug}`, 'addToCart', { sku, quantity: n })

export const tasks: Task[] = [
  {
    id: 'add-to-cart',
    prompt: 'Add a Heavyweight Tee in size M to my cart.',
    check: async (client) => (await quantity(client, 'TEE-BLK-M')) === 1,
    oracle: async (client) => (await add(client, 'heavyweight-tee', 'TEE-BLK-M'), 'Added.'),
  },
  {
    id: 'change-quantity',
    prompt: 'I want 3 of the Graphite keycap set that is in my cart, not 1. Fix the quantity.',
    setup: async (client) => void (await add(client, 'keycap-set', 'KEY-GRA')),
    check: async (client) => (await quantity(client, 'KEY-GRA')) === 3,
    oracle: async (client) => (
      await client.call('/cart', 'updateQuantity', { sku: 'KEY-GRA', quantity: 3 }),
      'Done.'
    ),
  },
  {
    id: 'checkout',
    prompt: 'Check out my cart. I approve placing the order.',
    setup: async (client) => void (await add(client, 'six-panel-cap', 'CAP-BLK')),
    check: async (client) =>
      (await orders(client)).length === 1 && (await cart(client)).items.length === 0,
    oracle: async (client) => (await client.call('/checkout', 'placeOrder', {}, true), 'Ordered.'),
  },
  {
    id: 'search',
    prompt: "What's the cheapest product in stock right now? Tell me its name and price.",
    check: async (_, answer) => /sticker sheet/i.test(answer) && answer.includes('$8.00'),
    oracle: async () => 'Sticker Sheet, $8.00',
  },
  {
    id: 'order-status',
    prompt: 'What did I order most recently, and what was the total?',
    setup: async (client) => {
      await add(client, 'sticker-sheet', 'STK-01', 2)
      await client.call('/checkout', 'placeOrder', {}, true)
    },
    check: async (_, answer) => /sticker sheet/i.test(answer) && answer.includes('$16.00'),
    oracle: async (client) => {
      const [last] = await orders(client)
      return `${last!.items[0]!.name}, ${last!.total}`
    },
  },
  // longer tasks, closer to what agents get asked: savings per step compound, and so do mistakes
  {
    id: 'two-items-checkout',
    prompt:
      'Buy a Heavyweight Tee in size M and the Graphite keycap set, then check out. I approve placing the order.',
    check: async (client) => {
      const [last, ...rest] = await orders(client)
      const names = (last?.items ?? []).map((item) => item.name).toSorted()
      return (
        !rest.length &&
        names.join() === 'Heavyweight Tee,Keycap Set' &&
        last!.total === '$112.00' &&
        (await cart(client)).items.length === 0
      )
    },
    oracle: async (client) => {
      await add(client, 'heavyweight-tee', 'TEE-BLK-M')
      await add(client, 'keycap-set', 'KEY-GRA')
      await client.call('/checkout', 'placeOrder', {}, true)
      return 'Ordered.'
    },
  },
  {
    id: 'edit-cart',
    prompt:
      'Change my cart: swap the black cap for the stone one, cut the stickers down to one sheet, and add an A3 grid poster.',
    setup: async (client) => {
      await add(client, 'six-panel-cap', 'CAP-BLK')
      await add(client, 'sticker-sheet', 'STK-01', 2)
    },
    check: async (client) => {
      const items = (await cart(client)).items
      const quantities = Object.fromEntries(items.map((item) => [item.sku, item.quantity]))
      return (
        items.length === 3 &&
        quantities['CAP-STN'] === 1 &&
        quantities['STK-01'] === 1 &&
        quantities['PST-A3'] === 1
      )
    },
    oracle: async (client) => {
      await client.call('/cart', 'removeItem', { sku: 'CAP-BLK' })
      await add(client, 'six-panel-cap', 'CAP-STN')
      await client.call('/cart', 'updateQuantity', { sku: 'STK-01', quantity: 1 })
      await add(client, 'grid-poster', 'PST-A3')
      return 'Done.'
    },
  },
]

// a session that exists but holds nothing: add then remove, so both agents start from the same place
export const newSession = async (site: string) => {
  const setup = createClient(site)
  await add(setup, 'sticker-sheet', 'STK-01')
  await setup.call('/cart', 'removeItem', { sku: 'STK-01' })
  const sid = setup.cookie('sid')
  if (!sid) throw new Error('the store did not start a session')
  return sid
}

// what live mode can start; the recorder rejects anything it doesn't know anyway (apps/bench/src/tasks.ts)
export const LIVE_TASKS = [
  { id: 'add-to-cart', prompt: 'Add a Heavyweight Tee in size M to my cart.' },
  {
    id: 'change-quantity',
    prompt: 'I want 3 of the Graphite keycap set that is in my cart, not 1. Fix the quantity.',
  },
  { id: 'checkout', prompt: 'Check out my cart. I approve placing the order.' },
  {
    id: 'search',
    prompt: "What's the cheapest product in stock right now? Tell me its name and price.",
  },
  { id: 'order-status', prompt: 'What did I order most recently, and what was the total?' },
  {
    id: 'two-items-checkout',
    prompt:
      'Buy a Heavyweight Tee in size M and the Graphite keycap set, then check out. I approve placing the order.',
  },
  {
    id: 'edit-cart',
    prompt:
      'Change my cart: swap the black cap for the stone one, cut the stickers down to one sheet, and add an A3 grid poster.',
  },
]

export const LIVE_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']

// which agents race. the discovery story leaves out checkout: placing an order through a page tool asks the
// person in the browser to confirm, and nobody's there
export const LIVE_PAIRINGS = [
  { agents: 'browser,afford,vision', story: 'race', tasks: LIVE_TASKS.map((t) => t.id) },
  {
    agents: 'browser,webmcp',
    story: 'discovery',
    tasks: ['add-to-cart', 'change-quantity', 'search'],
  },
] as const

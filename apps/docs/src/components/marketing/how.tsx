import { highlight } from '@affordances/ui/components/code-block'
import { Surfaces } from '@/components/marketing/surfaces'

// lines are 0-based into SOURCE; each surface lists the lines it reads
export const SOURCE = `'use server'

export const addToCart = defineAction({
  name: 'addToCart',
  description: 'Add a variant of this product to the cart',
  input: z.object({
    sku: z.string(),
    quantity: z.coerce.number().int().min(1).default(1),
  }),
  state: product,
  expose: 'public',
  requires: 'The variant is in stock',
  guard: ({ input, state }) =>
    !input || inStock(state, input.sku) || 'Sold out',
  effects: ['cart'],
  run: (input, ctx) => cart.add(ctx, input),
})`

const INPUT = [5, 6, 7, 8]

export const SURFACES = [
  {
    id: 'server',
    name: 'Server action',
    who: 'Humans',
    hint: '<form action>',
    agent: false,
    lines: [0, 2, ...INPUT, 15],
    note: 'A plain server action. The form’s fields are validated against `input` before `run` sees them.',
    lang: 'tsx',
    title: 'page.tsx',
    code: `import { addToCart } from './actions'

<form action={addToCart}>
  <input type="hidden" name="sku" value="TEE-BLK-M" />
  <button>Add to cart</button>
</form>`,
  },
  {
    id: 'webmcp',
    name: 'WebMCP tool',
    who: 'Browser agents',
    hint: 'registerTool',
    agent: true,
    lines: [3, 4, ...INPUT, 10, 12, 13],
    note: '`<AffordancesProvider>` registers it in the tab while the guard passes. Calls go through the same handler as any agent.',
    lang: 'ts',
    title: 'In the browser tab',
    code: `navigator.modelContext.registerTool({
  name: 'addToCart',
  description: 'Add a variant of this product to the cart',
  inputSchema: { type: 'object', required: ['sku'], … },
  annotations: { consequentialHint: false },
  execute: (input) => call('addToCart', input),
})`,
  },
  {
    id: 'http',
    name: 'HTTP',
    who: 'Headless agents',
    hint: 'POST /products/tee',
    agent: true,
    lines: [3, 10, 11, 12, 13, 14],
    note: 'The page’s own URL answers with a graph. A call returns a delta with only the entities in `effects`.',
    lang: 'bash',
    title: 'Terminal',
    code: `curl -H 'Accept: application/vnd.affordances+json' \\
  shop.example/products/tee
# "actions": [{ "name": "addToCart", "expose": "public",
#   "guard": "The variant is in stock", "available": true }]

curl -X POST shop.example/products/tee \\
  -H 'Content-Type: application/vnd.affordances+json' \\
  -d '{"action":"addToCart","input":{"sku":"TEE-BLK-M"}}'
# { "ok": true, "changed": { "cart": { "count": 1 } } }`,
  },
  {
    id: 'mcp',
    name: 'MCP',
    who: 'Claude, Cursor',
    hint: 'affordances_call',
    agent: true,
    lines: [3, 4, ...INPUT, 10],
    note: 'Two tools for the whole site. The model finds `addToCart` in the graph `affordances_open` returns, then calls it by name.',
    lang: 'ts',
    title: 'MCP client',
    code: `// vlx @affordances/mcp https://shop.example
// tools: affordances_open, affordances_call

affordances_call({
  path: '/products/tee',
  action: 'addToCart',
  input: { sku: 'TEE-BLK-M' },
})
// → { ok: true, changed: { cart: { count: 1 } } }`,
  },
  {
    id: 'md',
    name: 'Markdown',
    who: 'Readers and LLMs',
    hint: '/products/tee.md',
    agent: true,
    lines: [],
    note: 'Not from the action: the page itself, as text. Buttons drop out, so what it can do lives only in the graph.',
    lang: 'markdown',
    title: 'products/tee.md',
    code: `# Heavyweight Tee

$48.00

A boxy tee in dense 300 gsm cotton.

- Size: S (selected), M, L (unavailable), XL

Size L is sold out. 3 left in XL.`,
  },
] as const

// shiki reads Date.now(), which an uncached prerender rejects, hence "use cache" (as CodeBlock does)
export const HowItWorks = async () => {
  'use cache'
  const [source, ...artefacts] = await Promise.all([
    highlight({ code: SOURCE, lang: 'ts', title: 'actions.ts' }),
    ...SURFACES.map(({ code, lang, title }) => highlight({ code, lang, title })),
  ])
  return (
    <Surfaces
      source={source!}
      surfaces={SURFACES.map(({ id, name, who, hint, agent, lines, note }, i) => ({
        id,
        name,
        who,
        hint,
        agent,
        lines: [...lines],
        note,
        tab: artefacts[i]!,
      }))}
    />
  )
}

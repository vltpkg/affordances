import { CodeBlock } from '@afford/ui/components/code-block'
import { Wordmark } from '@afford/ui/components/wordmark'
import { GraphSpecimen } from './graph-specimen'

const action = `export const addToCart = defineAction({
  name: "addToCart",
  description: "Add a product variant to the cart",
  input: z.object({ sku: z.string(), size: z.number() }),
  expose: "session",
  guard: ({ input, state }) => inStock(state, input) || "size out of stock",
  effects: ["cart"],
  run: async (input, ctx) => cart.add(input),
});`

const Page = () => (
  <main className="mx-auto max-w-2xl px-4 py-24">
    <Wordmark />
    <h1 className="mt-8 text-4xl font-semibold tracking-tighter text-balance">
      Two views of one URL
    </h1>
    <p className="mt-4 text-muted-foreground">
      Declare an action once. People get a button, agents get a graph.
    </p>
    <div className="mt-12">
      <CodeBlock lang="ts" title="actions.ts">
        {action}
      </CodeBlock>
    </div>
    <GraphSpecimen />
  </main>
)

export default Page

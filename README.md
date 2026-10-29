# Affordances

Make any Next.js app agent-operable. Define an action once, and it becomes:

- a **server action** your UI calls,
- an **HTTP endpoint** at the page's own URL, for headless agents,
- a **WebMCP tool** in the browser, for agents running in the user's tab,
- and an **MCP tool**, through `npx @affordances/mcp <site>`.

Every page answers agents with a graph: what the page shows, what can be done there, and where to go next. Calling an action returns a delta, which is only the part of the page that changed. It's the same URL and the same session, and nothing is reachable until you say so.

```ts
// app/products/[slug]/actions.ts
'use server'
import { z } from 'zod'
import { defineAction } from '@/lib/affordances'
import { addItem } from '@/lib/store'
import product from './state'

export const addToCart = defineAction({
  name: 'addToCart',
  description: 'Add a size of this product to the cart',
  input: z.object({ sku: z.string(), quantity: z.coerce.number().int().min(1).default(1) }),
  state: product,
  expose: 'session',
  requires: 'The size is in stock',
  guard: ({ input, state }) =>
    !input ||
    state.product.variants.some((v) => v.sku === input.sku && v.stock > 0) ||
    'That size is sold out',
  effects: ['cart'],
  run: (input, ctx) => addItem(ctx.session!.id, input),
})
```

```ts
// app/products/[slug]/state.ts
import { defineState } from '@/lib/affordances'
import { getCart, getProduct } from '@/lib/store'

export default defineState(async ({ params, ctx }) => ({
  product: await getProduct(params.slug as string),
  cart: await getCart(ctx.session?.id),
}))
```

An agent reads the page:

```bash
curl -H 'Accept: application/vnd.affordances+json' https://shop.example/products/tee
```

and calls the action:

```bash
curl -X POST -H 'Content-Type: application/vnd.affordances+json' -H 'Authorization: Bearer <token>' \
  -d '{"action":"addToCart","input":{"sku":"TEE-BLK-M"}}' https://shop.example/products/tee
# {"ok":true,"changed":{"cart":{"count":1,"subtotal":4800}}}
```

## Quickstart

```bash
npm install @affordances/next @affordances/react zod
npx affordances init
```

`init` writes `app/api/affordances/graph/[[...path]]/route.ts`, wraps `next.config` with `withAffordances`, and adds `.affordances` to `.gitignore`. Then:

1. Create `lib/affordances.ts`: `export const { defineAction, defineState } = createAffordances({ auth })`, where `auth(request)` returns the session (or `null`). It resolves both people and agents.
2. Put `actions.ts` (`'use server'`) and `state.ts` next to any `page.tsx`.
3. Set `expose` on each action: `public`, `session`, or `confirm`. Actions without it stay invisible to agents.
4. Wrap the app in `<AffordancesProvider path={pathname + search}>` from `@affordances/react` to register WebMCP tools. Mark controls with `<Affordance action={addToCart}>` for DOM-reading agents.

To serve every page as markdown as well (at `/x.md`, or with `Accept: text/markdown`), add the md plugin:

```ts
// next.config.ts
import { withAffordances } from '@affordances/next/config'
import { md } from '@affordances/md/next'

export default withAffordances(nextConfig, { plugins: [md()] })
```

`npx affordances-md init` writes its route. `@affordances/md` also works on its own, with `withMd(nextConfig)` and no actions.

## Packages

| Package                 | What it does                                                                      |
| ----------------------- | --------------------------------------------------------------------------------- |
| `@affordances/protocol` | The [spec](packages/protocol/spec.md), its types, JSON Schemas, and fixtures      |
| `@affordances/core`     | `defineAction`, `defineState`, and a framework-agnostic `createHandler`           |
| `@affordances/next`     | `withAffordances`, codegen, the route handler, and `affordances init`             |
| `@affordances/react`    | `<AffordancesProvider>` (WebMCP), `<Affordance>`, and the `⌥A` dev overlay        |
| `@affordances/md`       | Any page as clean markdown at the same url, with `AgentMain`/`Skip`/`Only`/`Text` |
| `@affordances/mcp`      | Any Affordances site as an MCP server, plus the client the bench agent uses       |
| `@affordances/lint`     | `require-affordance` and `static-action-name`, for ESLint and oxlint              |

## Security

- **Default deny.** Only actions with `expose` are reachable.
- **Order of checks.** Every call is checked for origin and `expose`, then rate limited, then its input is validated, then the guard runs, and only then does the action run.
- **Origin.** A cookie-authenticated call needs a matching `Origin` header; bearer tokens are exempt.
- **Confirm.** A `confirm` action answers `confirm_required` with a summary until the call carries `confirm: true`. In the browser, the provider asks the person first.
- **Visibility.** A graph contains only what the page shows that user.

## Repo

```bash
vlt install
vlr build && vlr test && vlr lint && vlr fmt:check
cd apps/example && vlr dev   # the demo store on :3001
cd apps/docs && vlr dev      # docs on :3000
```

`apps/bench` runs the same shopping tasks with a browser agent and an Affordances agent. See its README for the exact command.

MIT

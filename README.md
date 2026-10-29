# Afford

Make any Next.js app agent-operable. Define an action once, and it becomes:

- a **server action** your UI calls,
- an **HTTP endpoint** at the page's own URL, for headless agents,
- a **WebMCP tool** in the browser, for agents running in the user's tab,
- and an **MCP tool**, through `npx @afford/mcp <site>`.

Every page answers agents with a graph: what the page shows, what can be done there, and where to go next. Calling an action returns a delta, which is only the part of the page that changed. It's the same URL and the same session, and nothing is reachable until you say so.

```ts
// app/products/[slug]/actions.ts
'use server'
import { z } from 'zod'
import { defineAction } from '@/lib/afford'
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
import { defineState } from '@/lib/afford'
import { getCart, getProduct } from '@/lib/store'

export default defineState(async ({ params, ctx }) => ({
  product: await getProduct(params.slug as string),
  cart: await getCart(ctx.session?.id),
}))
```

An agent reads the page:

```bash
curl -H 'Accept: application/vnd.afford+json' https://shop.example/products/tee
```

and calls the action:

```bash
curl -X POST -H 'Content-Type: application/vnd.afford+json' -H 'Authorization: Bearer <token>' \
  -d '{"action":"addToCart","input":{"sku":"TEE-BLK-M"}}' https://shop.example/products/tee
# {"ok":true,"changed":{"cart":{"count":1,"subtotal":4800}}}
```

## Quickstart

```bash
npm install @afford/next @afford/react zod
npx afford init
```

`init` writes `app/api/afford/graph/[[...path]]/route.ts`, wraps `next.config` with `withAfford`, and adds `.afford` to `.gitignore`. Then:

1. Create `lib/afford.ts`: `export const { defineAction, defineState } = createAfford({ auth })`, where `auth(request)` returns the session (or `null`). It resolves both people and agents.
2. Put `actions.ts` (`'use server'`) and `state.ts` next to any `page.tsx`.
3. Set `expose` on each action: `public`, `session`, or `confirm`. Actions without it stay invisible to agents.
4. Wrap the app in `<AffordProvider path={pathname + search}>` from `@afford/react` to register WebMCP tools. Mark controls with `<Affordance action={addToCart}>` for DOM-reading agents.

To serve every page as markdown as well (at `/x.md`, or with `Accept: text/markdown`), add the md plugin:

```ts
// next.config.ts
import { withAfford } from '@afford/next/config'
import { md } from '@afford/md/next'

export default withAfford(nextConfig, { plugins: [md()] })
```

`npx afford-md init` writes its route. `@afford/md` also works on its own, with `withMd(nextConfig)` and no actions.

## Packages

| Package            | What it does                                                                      |
| ------------------ | --------------------------------------------------------------------------------- |
| `@afford/protocol` | The [spec](packages/protocol/spec.md), its types, JSON Schemas, and fixtures      |
| `@afford/core`     | `defineAction`, `defineState`, and a framework-agnostic `createHandler`           |
| `@afford/next`     | `withAfford`, codegen, the route handler, and `afford init`                       |
| `@afford/react`    | `<AffordProvider>` (WebMCP), `<Affordance>`, and the `⌥A` dev overlay             |
| `@afford/md`       | Any page as clean markdown at the same url, with `AgentMain`/`Skip`/`Only`/`Text` |
| `@afford/mcp`      | Any Afford site as an MCP server, plus the client the bench agent uses            |
| `@afford/lint`     | `require-affordance` and `static-action-name`, for ESLint and oxlint              |

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

`apps/bench` runs the same shopping tasks with a browser agent and an Afford agent. See its README for the exact command.

MIT

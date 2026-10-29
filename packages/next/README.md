# @afford/next

Afford for Next.js: `withAfford` for `next.config.ts`, codegen that finds each route's `actions.ts` and `state.ts`, the route handler, and the `afford` CLI.

```bash
npm install @afford/next @afford/react zod
npx @afford/next init
```

`init` writes `app/api/afford/graph/[[...path]]/route.ts`, wraps your config, and generates `.afford/manifest.ts`. Then describe a page next to it:

```ts
// app/guestbook/actions.ts
'use server'

import { z } from 'zod'
import { defineAction } from '@afford/next'
import guestbook from './state'

export const sign = defineAction({
  name: 'sign',
  description: 'Add a message to the guestbook',
  input: z.object({ name: z.string().min(1), message: z.string().max(280) }),
  state: guestbook,
  expose: 'public',
  effects: ['entries'],
  run: (input) => entries.add(input),
})
```

`curl -H 'Accept: application/vnd.afford+json' localhost:3000/guestbook` returns the page's graph, and a POST with `Content-Type: application/vnd.afford+json` calls `sign`.

Docs: [https://github.com/afford/afford/blob/main/apps/docs/content/quickstart.mdx](https://github.com/afford/afford/blob/main/apps/docs/content/quickstart.mdx) and [https://github.com/afford/afford/blob/main/apps/docs/content/nextjs.mdx](https://github.com/afford/afford/blob/main/apps/docs/content/nextjs.mdx)

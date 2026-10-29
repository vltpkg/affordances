# @affordances/next

Affordances for Next.js: `withAffordances` for `next.config.ts`, codegen that finds each route's `actions.ts` and `state.ts`, the route handler, and the `affordances` CLI.

```bash
vlt install @affordances/next @affordances/react zod
vlx @affordances/next init
```

`init` writes `app/api/affordances/graph/[[...path]]/route.ts`, wraps your config, and generates `.affordances/manifest.ts`. Then describe a page next to it:

```ts
// app/guestbook/actions.ts
'use server'

import { z } from 'zod'
import { defineAction } from '@affordances/next'
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

`curl -H 'Accept: application/vnd.affordances+json' localhost:3000/guestbook` returns the page's graph, and a POST with `Content-Type: application/vnd.affordances+json` calls `sign`.

Docs: [https://github.com/affordances/affordances/blob/main/apps/docs/content/quickstart.mdx](https://github.com/affordances/affordances/blob/main/apps/docs/content/quickstart.mdx) and [https://github.com/affordances/affordances/blob/main/apps/docs/content/guides/nextjs/index.mdx](https://github.com/affordances/affordances/blob/main/apps/docs/content/guides/nextjs/index.mdx)

# @affordances/core

The framework-agnostic core of Affordances: `defineAction` and `defineState` (or `createAffordances` for a shared session resolver), and `createHandler`, which answers graph and call requests as a `(request: Request) => Promise<Response>`. Framework adapters such as `@affordances/next` build on it.

```bash
vlt install @affordances/core zod
```

```ts
import { z } from 'zod'
import { createHandler, defineAction, defineState } from '@affordances/core'

const guestbook = defineState(async () => ({ entries: await entries.list() }))

const sign = defineAction({
  name: 'sign',
  description: 'Add a message to the guestbook',
  input: z.object({ name: z.string().min(1), message: z.string().max(280) }),
  state: guestbook,
  expose: 'public',
  effects: ['entries'],
  run: (input) => entries.add(input),
})

export const handler = createHandler({
  manifest: { routes: { '/guestbook': { state: guestbook, actions: [sign] } } },
})
```

Docs: [https://github.com/affordances/affordances/blob/main/apps/docs/content/concepts/actions.mdx](https://github.com/affordances/affordances/blob/main/apps/docs/content/concepts/actions.mdx)

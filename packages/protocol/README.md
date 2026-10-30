# @affordances/protocol

The Affordances protocol: TypeScript types and zod schemas for graphs, calls, deltas, and the site index, the JSON Schemas generated from them, the protocol constants, and the normative `spec.md`. The other Affordances packages import their types from here.

```bash
vlt install @affordances/protocol
```

```ts
import { Delta, Graph, MEDIA_TYPE } from '@affordances/protocol'

const response = await fetch('https://store.example.com/products/tee', {
  headers: { accept: MEDIA_TYPE },
})
const graph = Graph.parse(await response.json())
```

The JSON Schemas are at `@affordances/protocol/schemas/*.json`, example documents at `@affordances/protocol/fixtures/*`, and the spec at `@affordances/protocol/spec.md`.

Read the protocol: [https://github.com/vltpkg/affordances/blob/main/apps/docs/content/protocol.mdx](https://github.com/vltpkg/affordances/blob/main/apps/docs/content/protocol.mdx)

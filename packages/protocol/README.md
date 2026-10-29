# @afford/protocol

The Afford protocol: TypeScript types and zod schemas for graphs, calls, deltas, and the site index, the JSON Schemas generated from them, the protocol constants, and the normative `spec.md`. The other Afford packages import their types from here.

```bash
vlt install @afford/protocol
```

```ts
import { Delta, Graph, MEDIA_TYPE } from '@afford/protocol'

const response = await fetch('https://store.example.com/products/tee', {
  headers: { accept: MEDIA_TYPE },
})
const graph = Graph.parse(await response.json())
```

The JSON Schemas are at `@afford/protocol/schemas/*.json`, example documents at `@afford/protocol/fixtures/*`, and the spec at `@afford/protocol/spec.md`.

Read the protocol: [https://github.com/afford/afford/blob/main/apps/docs/content/protocol.mdx](https://github.com/afford/afford/blob/main/apps/docs/content/protocol.mdx)

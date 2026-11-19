# v0 golden check (M7b)

apps/example is a v0-only app: no capability modules and no capability ids. M7b promises that it serves byte-identical v0 documents before and after the semantic-capabilities work. Every route's `Graph` (with and without a session), the site index, and four `Call`s with their `Delta`s.

`golden.test.ts` writes them as one JSON document, `out.json`, in this directory. To compare two commits, run it from `apps/example` in a clean export of each, and diff the two files:

```sh
npx vitest run --config scripts/v0-golden/vitest.config.ts
```

Outside Next, there's no request store, so `next/cache`'s `revalidatePath` and `next/headers`' `cookies` are stubbed to do nothing. A run's `out.json` isn't committed.

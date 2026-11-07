# streamed-react19.html: how it was captured

Real output of `next build && next start` (Next 16.4.3, webpack build; React 19.3.1, react-dom 19.3.1) with
`cacheComponents: true`, saved with `curl -s localhost:3978/products`. `/products` is a partial prerender: the shell is
static and each `<Suspense>` boundary streams in after it, revealed by React's `$RC` instructions.

What it covers: 18 boundaries, so ids run past `B:9` into hex (`B:a`…`B:11`); twelve that resolve together, in one
batch; a nested boundary; table rows streamed into a `<tbody>`; a boundary whose component throws, which React leaves to
the client (`$RX`), so its fallback stays; and dehydrated query state (TanStack Query's `HydrationBoundary` shape)
passed to a client component, which lands in the page's flight data and must never reach the markdown.

To capture it again, make an app with these files, plus `next`, `react` and `react-dom`, then build, start and curl.

`next.config.mjs`:

```js
export default { cacheComponents: true }
```

`app/layout.jsx`:

```jsx
export default function Layout({ children }) {
  return <html lang="en"><body>{children}</body></html>
}
```

`app/products/hydrate.jsx`:

```jsx
'use client'
// stands in for TanStack's <HydrationBoundary state={dehydrate(queryClient)}>: a client component whose props
// carry the dehydrated queries, so they ride along in the page's flight data
export function Hydrate({ state, children }) {
  return children
}
```

`app/products/page.jsx`:

```jsx
import { Suspense } from 'react'
import { connection } from 'next/server'
import { Hydrate } from './hydrate'

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function Slow({ ms, children }) {
  await connection()
  await wait(ms)
  return children
}

async function Broken() {
  await connection()
  await wait(100)
  throw new Error('recommendations failed')
}

const sizes = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL', '6XL', '7XL', '8XL']

const dehydrated = {
  queries: [
    {
      queryKey: ['product', 'tee'],
      state: { status: 'pending', data: undefined, fetchStatus: 'fetching' },
      dehydratedAt: 1,
    },
    {
      queryKey: ['inventory'],
      state: { status: 'success', data: { warehouse: 'rq-dehydrated-payload' } },
      dehydratedAt: 1,
    },
  ],
}

export default function Page() {
  return (
    <main>
      <h1>Products</h1>
      <p>Shell text, rendered first.</p>
      <Hydrate state={dehydrated}>
        <Suspense fallback={<p>Loading price…</p>}>
          <Slow ms={300}><p>Price: $48</p></Slow>
        </Suspense>
      </Hydrate>
      <Suspense fallback={<p>Loading stock…</p>}>
        <Slow ms={300}><p>In stock: 12</p></Slow>
      </Suspense>
      <h2>Sizes</h2>
      <ul>
        {sizes.map((size) => (
          <Suspense key={size} fallback={<li>Loading {size}…</li>}>
            <Slow ms={400}><li>Size {size} available</li></Slow>
          </Suspense>
        ))}
      </ul>
      <table>
        <thead><tr><th>Color</th><th>Stock</th></tr></thead>
        <tbody>
          <Suspense fallback={<tr><td>Loading colors…</td><td></td></tr>}>
            <Slow ms={400}>
              <tr><td>Black</td><td>7</td></tr>
              <tr><td>Bone</td><td>5</td></tr>
            </Slow>
          </Suspense>
        </tbody>
      </table>
      <Suspense fallback={<p>Loading reviews…</p>}>
        <Slow ms={600}>
          <section>
            <h2>Reviews</h2>
            <Suspense fallback={<p>Loading review details…</p>}>
              <Slow ms={300}><p>Five stars from Ada.</p></Slow>
            </Suspense>
          </section>
        </Slow>
      </Suspense>
      <Suspense fallback={<p>Loading recommendations…</p>}>
        <Broken />
      </Suspense>
    </main>
  )
}
```

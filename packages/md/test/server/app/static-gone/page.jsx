import { notFound } from 'next/navigation'
import { Suspense } from 'react'

// nothing dynamic: prerendered by next build, with notFound() in a boundary (16.3.0 sends it as a 200)
function Item() {
  notFound()
}

export default function Page() {
  return (
    <>
      <h1>Item</h1>
      <Suspense fallback={<p>Loading…</p>}>
        <Item />
      </Suspense>
    </>
  )
}

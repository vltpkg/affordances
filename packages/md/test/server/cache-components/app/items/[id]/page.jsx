import { notFound } from 'next/navigation'
import { Suspense } from 'react'

const ITEMS = { 1: 'Lamp' }

// read in a <Suspense>, so it's a hole in the prerendered shell: an unknown id's notFound() arrives in the resumed
// stream, after the shell
async function Item({ params }) {
  const { id } = await params
  if (!ITEMS[id]) notFound()
  return <p>{`Item ${id}: ${ITEMS[id]}`}</p>
}

export default function Page({ params }) {
  return (
    <>
      <h1>Items</h1>
      <Suspense fallback={<p>Loading…</p>}>
        <Item params={params} />
      </Suspense>
    </>
  )
}

import { notFound } from 'next/navigation'
import { Suspense } from 'react'

const THINGS = { 1: 'Chair' }

// the same shape as items/[id], with no markdown.js: an unknown id gets the app's own not-found.
// read in a <Suspense>, so it's a hole in the prerendered shell: an unknown id's notFound() arrives in the resumed
// stream, after the shell
async function Thing({ params }) {
  const { id } = await params
  if (!THINGS[id]) notFound()
  return <p>{`Thing ${id}: ${THINGS[id]}`}</p>
}

export default function Page({ params }) {
  return (
    <>
      <h1>Things</h1>
      <Suspense fallback={<p>Loading…</p>}>
        <Thing params={params} />
      </Suspense>
    </>
  )
}

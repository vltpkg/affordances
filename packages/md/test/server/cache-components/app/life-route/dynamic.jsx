import { connection } from 'next/server'
import { Suspense } from 'react'

// each life-route/<profile>'s page: dynamic, so its markdown is public only through its markdown.js's publicCache
async function Now() {
  await connection()
  return <p>Rendered on request.</p>
}

export default function Page() {
  return (
    <>
      <h1>Life route</h1>
      <Suspense fallback={<p>Loading…</p>}>
        <Now />
      </Suspense>
    </>
  )
}

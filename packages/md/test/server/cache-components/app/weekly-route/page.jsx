import { connection } from 'next/server'
import { Suspense } from 'react'

// dynamic, so its markdown is public only through markdown.ts's publicCache, with the app's own profile
async function Now() {
  await connection()
  return <p>Rendered on request.</p>
}

export default function Page() {
  return (
    <>
      <h1>Weekly route</h1>
      <Suspense fallback={<p>Loading…</p>}>
        <Now />
      </Suspense>
    </>
  )
}

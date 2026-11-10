import { connection } from 'next/server'
import { Suspense } from 'react'

// a part of the page that throws after the shell went out: its boundary keeps its fallback, and error.jsx shows
async function Report() {
  await connection()
  await new Promise((resolve) => setTimeout(resolve, 50))
  throw new Error('the report service is down')
}

export default function Page() {
  return (
    <>
      <h1>Report</h1>
      <Suspense fallback={<p>Loading…</p>}>
        <Report />
      </Suspense>
    </>
  )
}

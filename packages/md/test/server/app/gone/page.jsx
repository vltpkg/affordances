import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import { Suspense } from 'react'

// notFound() after the shell went out, which next sends as a 200
async function Item() {
  await connection()
  await new Promise((resolve) => setTimeout(resolve, 50))
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

import { unauthorized } from 'next/navigation'
import { connection } from 'next/server'
import { Suspense } from 'react'

// unauthorized() after the shell went out, which next sends as a 200 (experimental.authInterrupts)
async function Item() {
  await connection()
  await new Promise((resolve) => setTimeout(resolve, 50))
  unauthorized()
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

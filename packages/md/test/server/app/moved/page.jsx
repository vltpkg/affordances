import { redirect } from 'next/navigation'
import { connection } from 'next/server'
import { Suspense } from 'react'

// redirect() after the shell went out, which next streams into a 200
async function Item() {
  await connection()
  await new Promise((resolve) => setTimeout(resolve, 50))
  redirect('/ok')
}

export default function Page() {
  return (
    <>
      <h1>Moved</h1>
      <Suspense fallback={<p>Loading…</p>}>
        <Item />
      </Suspense>
    </>
  )
}

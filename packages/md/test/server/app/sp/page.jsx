import { Suspense } from 'react'
import { Search } from './search'

// a static page whose search box reads the query in the browser, as next documents it
export default function Page() {
  return (
    <>
      <h1>Search</h1>
      <Suspense fallback={<p>Loading…</p>}>
        <Search />
      </Suspense>
    </>
  )
}

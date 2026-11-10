import { headers } from 'next/headers'

// the Host the request came with, so the matrix can tell a caller's Host reached next
export default async function Page() {
  return <h1>{(await headers()).get('host')}</h1>
}

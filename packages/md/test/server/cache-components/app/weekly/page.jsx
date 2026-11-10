import { cacheLife } from 'next/cache'

// a cacheLife profile of the app's own, from next.config
export default async function Page() {
  'use cache'
  cacheLife('weekly')
  return <h1>Weekly</h1>
}

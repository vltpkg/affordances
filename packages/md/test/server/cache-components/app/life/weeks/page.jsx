import { cacheLife } from 'next/cache'

// cached by next's built-in 'weeks' profile: the Cache-Control life-route/weeks's twin must match
export default async function Page() {
  'use cache'
  cacheLife('weeks')
  return <h1>Life weeks</h1>
}

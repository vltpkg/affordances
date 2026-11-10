import { cacheLife } from 'next/cache'

// cached by next's built-in 'minutes' profile: the Cache-Control life-route/minutes's twin must match
export default async function Page() {
  'use cache'
  cacheLife('minutes')
  return <h1>Life minutes</h1>
}

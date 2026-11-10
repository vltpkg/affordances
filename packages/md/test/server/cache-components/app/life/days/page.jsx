import { cacheLife } from 'next/cache'

// cached by next's built-in 'days' profile: the Cache-Control life-route/days's twin must match
export default async function Page() {
  'use cache'
  cacheLife('days')
  return <h1>Life days</h1>
}

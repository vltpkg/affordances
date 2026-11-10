import { cacheLife } from 'next/cache'

// cached by next's built-in 'hours' profile: the Cache-Control life-route/hours's twin must match
export default async function Page() {
  'use cache'
  cacheLife('hours')
  return <h1>Life hours</h1>
}

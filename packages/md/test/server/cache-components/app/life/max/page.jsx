import { cacheLife } from 'next/cache'

// cached by next's built-in 'max' profile: the Cache-Control life-route/max's twin must match
export default async function Page() {
  'use cache'
  cacheLife('max')
  return <h1>Life max</h1>
}

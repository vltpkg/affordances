import { cacheLife } from 'next/cache'

// cached by next's built-in 'default' profile: the Cache-Control life-route/default's twin must match
export default async function Page() {
  'use cache'
  cacheLife('default')
  return <h1>Life default</h1>
}

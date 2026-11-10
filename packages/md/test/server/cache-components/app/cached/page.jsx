import { cacheLife } from 'next/cache'

// cached for days by the page itself: its twin is cached the same, with no markdown.ts
export default async function Page() {
  'use cache'
  cacheLife('days')
  return <h1>Cached</h1>
}

import { AgentSlot } from '@affordances/md/react'
import { cacheLife } from 'next/cache'

// a cached page with a slot: the fill reads data with whatever the request carried, so the twin stays private
export default async function Page() {
  'use cache'
  cacheLife('days')
  return (
    <>
      <h1>Slotted</h1>
      <AgentSlot name="readme">
        <p>Loading…</p>
      </AgentSlot>
    </>
  )
}

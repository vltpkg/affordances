'use client'

import { MEDIA_TYPE } from '@affordances/protocol'
import { useAffordances } from '@affordances/react'
import { cn } from 'cn'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { JsonView } from '@affordances/ui/components/json-view'
import { Toggle } from '@affordances/ui/components/toggle'
import { usePagePath } from './affordances-provider'

// per tab, for the session: survives navigation and reloads, not a new tab
const key = 'affordances-agent-view'
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
const read = () => {
  try {
    return sessionStorage.getItem(key) === '1'
  } catch {
    return false
  }
}
const write = (on: boolean) => {
  try {
    sessionStorage.setItem(key, on ? '1' : '0')
  } catch {}
  for (const listener of listeners) listener()
}
const useAgentView = () => useSyncExternalStore(subscribe, read, () => false)

export const AgentViewToggle = () => {
  const on = useAgentView()
  return (
    <Toggle
      // a demo control, not part of the store: the bench hides it from the browser agent
      data-demo-only
      pressed={on}
      onPressedChange={write}
      className="h-7 px-2 font-pixel text-[13.16px] font-normal text-muted-foreground hover:text-foreground aria-pressed:text-foreground"
    >
      Agent view
    </Toggle>
  )
}

const fade =
  'motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200 motion-safe:ease-out'

// the same url, rendered for people or as the graph an agent gets
export const AgentFrame = ({ children }: { children: React.ReactNode }) => {
  const on = useAgentView()
  // crossfade only after a switch, never on page load
  const [last, setLast] = useState(on)
  const [switched, setSwitched] = useState(false)
  if (on !== last) {
    setLast(on)
    setSwitched(true)
  }
  return (
    <>
      {/* hidden, not unmounted, so the page keeps its state while the graph shows */}
      <div hidden={on} className={cn(switched && fade)}>
        {children}
      </div>
      {on && <GraphPanel className={cn(switched && fade)} />}
    </>
  )
}

const GraphPanel = ({ className }: { className?: string }) => {
  const path = usePagePath()
  const { graph, lastDelta, refresh } = useAffordances()
  // the provider refetches after its own calls, not after a person's form submit, so refetch on open
  useEffect(() => {
    refresh().catch(() => {})
  }, [refresh])
  const highlight = Object.keys(lastDelta?.changed ?? {}).map((entity) => `entities.${entity}`)

  return (
    <section aria-label="Agent view" className={cn('min-w-0', className)}>
      <div className="font-mono text-xs/5 text-muted-foreground">
        <p className="truncate">
          <span className="text-foreground">GET</span> {path}
        </p>
        <p>Accept: {MEDIA_TYPE}</p>
      </div>
      <div className="mt-4 min-h-24 overflow-x-auto rounded-lg border bg-illustration p-4 text-xs">
        {graph ? (
          <JsonView value={graph} highlight={highlight} />
        ) : (
          <p className="text-muted-foreground">No graph yet.</p>
        )}
      </div>
    </section>
  )
}

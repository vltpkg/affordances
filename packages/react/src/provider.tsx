'use client'

import { createContext, use, useCallback, useEffect, useRef, useState } from 'react'
import { MEDIA_TYPE, type Delta, type Graph } from '@afford/protocol'
import { getModelContext } from './model-context.ts'

export type AffordContext = {
  // this page's graph, or null while it loads or when the page has none
  graph: Graph | null
  // calls an action on this page as an agent would, confirming `confirm` actions with the person first
  call: (action: string, input?: unknown) => Promise<Delta>
  // the most recent call's delta, for the dev overlay
  lastDelta: Delta | null
  // refetches the graph, e.g. after a person changed the page through a form
  refresh: () => Promise<void>
}

const Context = createContext<AffordContext | null>(null)

export type AffordProviderProps = {
  children: React.ReactNode
  // the current page's path and query; change it on navigation so the graph and tools follow
  path: string
  // after every call, e.g. to refresh server-rendered UI (next: router.refresh)
  onDelta?: (delta: Delta) => void
  // asked before a `confirm` action runs; resolve true to go ahead
  confirm?: (message: string) => boolean | Promise<boolean>
}

const post = (path: string, body: object) =>
  fetch(path, {
    method: 'POST',
    headers: { 'content-type': MEDIA_TYPE, accept: MEDIA_TYPE },
    body: JSON.stringify(body),
  }).then((response) => response.json() as Promise<Delta>)

export const AffordProvider = ({
  children,
  path,
  onDelta,
  confirm = (message) => window.confirm(message),
}: AffordProviderProps) => {
  const [graph, setGraph] = useState<Graph | null>(null)
  const [lastDelta, setLastDelta] = useState<Delta | null>(null)
  // read in callbacks without re-registering every tool when a parent re-renders
  const handlers = useRef({ onDelta, confirm })
  useEffect(() => {
    handlers.current = { onDelta, confirm }
  })

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const response = await fetch(path, { headers: { accept: MEDIA_TYPE }, signal })
      const isGraph = response.ok && response.headers.get('content-type')?.includes(MEDIA_TYPE)
      setGraph(isGraph ? ((await response.json()) as Graph) : null)
    },
    [path],
  )

  useEffect(() => {
    const controller = new AbortController()
    // load sets state only once the fetch resolves, not synchronously
    // oxlint-disable-next-line react/set-state-in-effect
    load(controller.signal).catch(() => {})
    return () => controller.abort()
  }, [load])

  const call = useCallback(
    async (action: string, input?: unknown) => {
      let delta = await post(path, { action, input })
      if (
        delta.error?.code === 'confirm_required' &&
        (await handlers.current.confirm(delta.error.message))
      )
        delta = await post(path, { action, input, confirm: true })
      setLastDelta(delta)
      handlers.current.onDelta?.(delta)
      await load().catch(() => {})
      return delta
    },
    [path, load],
  )

  // every available action on the page becomes a WebMCP tool; aborting the signal unregisters them
  useEffect(() => {
    const modelContext = getModelContext()
    if (!modelContext || !graph) return
    const controller = new AbortController()
    for (const action of graph.actions) {
      if (!action.available) continue
      try {
        Promise.resolve(
          modelContext.registerTool(
            {
              name: action.name,
              description: action.description,
              inputSchema: action.input,
              annotations: {
                readOnlyHint: action.readOnly ?? false,
                consequentialHint: action.expose === 'confirm',
              },
              execute: async (input) => JSON.stringify(await call(action.name, input)),
            },
            { signal: controller.signal },
          ),
        ).catch(() => {})
      } catch {
        // a tool the browser refused (e.g. a name it already has) shouldn't stop the rest
      }
    }
    return () => controller.abort()
  }, [graph, call])

  const refresh = useCallback(() => load(), [load])

  return <Context value={{ graph, call, lastDelta, refresh }}>{children}</Context>
}

export const useAfford = () => {
  const context = use(Context)
  if (!context) throw new Error('useAfford needs an <AffordProvider> above it')
  return context
}

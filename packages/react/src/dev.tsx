'use client'

import { useEffect, useState } from 'react'
import { useAffordances } from './provider.tsx'

type Box = {
  name: string
  available: boolean
  reason?: string
  top: number
  left: number
  width: number
  height: number
}

const mono = 'var(--font-geist-mono, ui-monospace, SFMono-Regular, monospace)'

// <Affordance> renders display: contents, so measure what's inside it
const measure = (marker: Element) => {
  const rects = [...marker.children].flatMap((child) => [...child.getClientRects()])
  if (!rects.length) return
  const top = Math.min(...rects.map((r) => r.top))
  const left = Math.min(...rects.map((r) => r.left))
  return {
    top,
    left,
    width: Math.max(...rects.map((r) => r.right)) - left,
    height: Math.max(...rects.map((r) => r.bottom)) - top,
  }
}

// dev only: ⌥A outlines every affordance on the page with its action name and availability, and shows the last delta
export const AffordancesDevtools = ({ shortcut = 'KeyA' }: { shortcut?: string }) => {
  const { graph, lastDelta } = useAffordances()
  const [open, setOpen] = useState(false)
  const [boxes, setBoxes] = useState<Box[]>([])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey && event.code === shortcut) setOpen((value) => !value)
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [shortcut])

  useEffect(() => {
    if (!open) return
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const actions = new Map(graph?.actions.map((a) => [a.name, a]))
        setBoxes(
          [...document.querySelectorAll('[data-affordances-action]')].flatMap((marker) => {
            const rect = measure(marker)
            const name = marker.getAttribute('data-affordances-action')!
            const action = actions.get(name)
            return rect
              ? [{ name, available: action?.available ?? false, reason: action?.reason, ...rect }]
              : []
          }),
        )
      })
    }
    update()
    const observer = new MutationObserver(update)
    observer.observe(document.body, { subtree: true, childList: true, attributes: true })
    addEventListener('scroll', update, { passive: true, capture: true })
    addEventListener('resize', update)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      removeEventListener('scroll', update, { capture: true })
      removeEventListener('resize', update)
    }
  }, [open, graph])

  if (!open) return null
  return (
    <div
      data-affordances-devtools=""
      aria-live="polite"
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 2147483647,
        fontFamily: mono,
        fontSize: 11,
      }}
    >
      {boxes.map((box, i) => (
        <div
          key={i}
          style={{
            position: 'fixed',
            top: box.top - 3,
            left: box.left - 3,
            width: box.width + 6,
            height: box.height + 6,
            border: `1px ${box.available ? 'solid' : 'dashed'} currentColor`,
            borderRadius: 6,
            color: 'var(--foreground, #111)',
          }}
        >
          <span
            style={{
              position: 'absolute',
              bottom: '100%',
              left: -1,
              marginBottom: 2,
              padding: '1px 5px',
              borderRadius: 4,
              background: 'var(--foreground, #111)',
              color: 'var(--background, #fff)',
              whiteSpace: 'nowrap',
              lineHeight: '16px',
            }}
          >
            {box.name}
            {!box.available && ` · ${box.reason ?? 'unavailable'}`}
          </span>
        </div>
      ))}
      <section
        aria-label="Affordances devtools"
        style={{
          position: 'fixed',
          right: 16,
          bottom: 16,
          width: 320,
          maxHeight: '40vh',
          overflow: 'auto',
          pointerEvents: 'auto',
          padding: 12,
          borderRadius: 8,
          border: '1px solid var(--border, #e5e5e5)',
          background: 'var(--background, #fff)',
          color: 'var(--foreground, #111)',
        }}
      >
        <p style={{ margin: 0, color: 'var(--muted-foreground, #666)' }}>
          {graph
            ? `${graph.route} · ${graph.actions.length} actions · ${boxes.length} on screen`
            : 'No graph for this page'}
        </p>
        <pre style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {lastDelta ? JSON.stringify(lastDelta, null, 2) : 'Call an action to see its delta.'}
        </pre>
      </section>
    </div>
  )
}

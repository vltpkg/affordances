'use client'

import { useEffect } from 'react'
import { registerWebMcp } from '@affordances/webmcp'

// the page's WebMCP tools (RFC 0004 §5, M7d): version 1's generic tools over the projection route, in the person's own
// browser and session. Where the browser has no WebMCP, nothing registers

// the person's consent, used only where the browser gives a tool requestUserInteraction; no current build does, so a
// call that needs confirmation returns its refusal, and the person confirms on the review-and-confirm page
const ask = async (summary: string) => window.confirm(`Approve this?\n\n${summary}`)

type Start = { type: string; key: string }

// the effect's body, with React's cleanup as its return: register under a signal, and abort it to unregister, so the
// same names can register again (Chromium rejects a live name as a duplicate). That covers development mode's doubled
// effect, and a start that changes while the layout stays mounted, which a module-level "registered" flag pinned to
// the first for the page's life (intake's code review, #7)
export const mountWebMcp = (
  start: Start | undefined,
  options: Pick<Parameters<typeof registerWebMcp>[0], 'context' | 'fetcher'> = {},
) => {
  const registration = new AbortController()
  // exhaustive: an agent in the browser is shown every offer the person may see, as protocol 1's full view is
  registerWebMcp({
    base: '/api/projection',
    ask,
    view: { policy: 'exhaustive' },
    ...(start && { start }),
    ...options,
    signal: registration.signal,
  })
  return () => registration.abort()
}

// start: the page's resource, the person's own project, as the first view's start (intake, 2026-11-18). It's a view
// parameter only: the route checks every offer and every call against the session's principal, whatever it names.
// The effect depends on its parts, since the layout makes a new object on every render
export const WebMcp = ({ start }: { start?: Start }) => {
  const type = start?.type
  const key = start?.key
  useEffect(
    () => mountWebMcp(type !== undefined && key !== undefined ? { type, key } : undefined),
    [type, key],
  )
  return null
}

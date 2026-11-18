'use client'

import { useEffect } from 'react'
import { registerWebMcp } from '@affordances/webmcp'

// the page's WebMCP tools (RFC 0004 §5, M7d): version 1's generic tools over the projection route, in the person's own
// browser and session. Registered once per page: React's development mode runs an effect twice, and the same names
// can't register twice. Where the browser has no WebMCP, nothing registers
let registered = false

// the person's consent, used only where the browser gives a tool requestUserInteraction; no current build does, so a
// call that needs confirmation returns its refusal, and the person confirms on the review-and-confirm page
const ask = async (summary: string) => window.confirm(`Approve this?\n\n${summary}`)

export const WebMcp = () => {
  useEffect(() => {
    if (registered) return
    registered = true
    // exhaustive: an agent in the browser is shown every offer the person may see, as protocol 1's full view is
    registerWebMcp({ base: '/api/projection', ask, view: { policy: 'exhaustive' } })
  }, [])
  return null
}

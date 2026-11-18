import { builtInPolicies } from '@affordances/runtime'
import type { Condition } from './conditions.ts'

// M7f's surfaces (surfaces/PLAN.md §3): what the agent is given, the one factor the comparison varies (§2). Everything
// else is held fixed: the task T6, the fixture's pinned export, the claim edit, the models, the caps, the simulated
// user, and a fresh hosting-lab server per trial on its worker's port (the planner, 2026-11-18 14:10Z)

export type SurfaceId = 'full' | 'progressive' | 'v0' | 'browser' | 'mcp' | 'webmcp'
export type Surface = {
  id: SurfaceId
  name: string
  // how the agent's tools are made: the benchmark's four (over protocol 1), v0's two, the browser's five, or the
  // product's MCP and WebMCP tools
  kind: 'tools' | 'v0' | 'browser' | 'mcp' | 'webmcp'
  // the prompt's one line that differs by surface: it names the surface's tools (§2), and is recorded
  instruction: string
  // for the four tools: the condition whose policy they project under
  condition?: Condition
  // MCP and WebMCP are described in the pilot, never estimated (§3)
  pilotOnly?: true
}

// the approval, identical on every surface's instruction line (intake, 2026-11-18 18:37Z, after the pilot): the
// person has already approved the purchase, so no surface's agent stops to ask. One sentence, the same bytes everywhere,
// so the instruction line stays the prompt's only difference between surfaces, as the preflight checks
export const APPROVAL =
  'The person has approved completing the purchase you judge best; complete it without asking.'
const line = (tools: string) => `${tools} ${APPROVAL}`

const builtIn = (id: string) => {
  const p = builtInPolicies.find((x) => x.id === id)
  if (!p) throw new Error(`the runtime has no built-in policy ${id}`)
  return p
}
// the four tools' surfaces: the benchmark's tools, unchanged from M5, under a built-in policy, with §6.6's comparison
const tools = (id: 'full' | 'progressive', policy: string, name: string): Surface => ({
  id,
  name,
  kind: 'tools',
  instruction: line('Your tools are project, expand, inspect and execute.'),
  condition: { id: 'A', name, policy: builtIn(policy), manipulates: [] },
})

export const surfaces: Record<SurfaceId, Surface> = {
  full: tools('full', 'exhaustive', 'protocol 1, the full graph'),
  progressive: tools('progressive', 'progressive', 'protocol 1, the progressive graph'),
  v0: {
    id: 'v0',
    name: 'Affordances v0',
    kind: 'v0',
    instruction: line('Your tools are affordances_open and affordances_call.'),
  },
  browser: {
    id: 'browser',
    name: 'browser automation',
    kind: 'browser',
    instruction: line('Your tools are open, snapshot, click, fill and submit.'),
  },
  mcp: {
    id: 'mcp',
    name: 'MCP, generic mode',
    kind: 'mcp',
    instruction: line('Your tools are project, expand, inspect and execute.'),
    pilotOnly: true,
  },
  webmcp: {
    id: 'webmcp',
    name: 'WebMCP',
    kind: 'webmcp',
    instruction: line('Your tools are the page’s project, expand, inspect and execute.'),
    pilotOnly: true,
  },
}

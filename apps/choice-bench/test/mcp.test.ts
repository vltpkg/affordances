import { expect, test } from 'vitest'
import type { McpCall } from '../src/mcp-server.ts'
import { declaresElicitation, mcpCompleted, mcpRequestsOf, mcpUnauthorized } from '../src/mcp.ts'

// the MCP pilot surface's request events and its finding (the planner, 15:55Z), from synthetic records

const call = (
  tool: string,
  input: Record<string, unknown>,
  output: unknown,
  at = 0,
  ms = 10,
): McpCall => ({
  tool,
  input,
  output,
  isError: false,
  at,
  ms,
})
const offer = 'hosting.plan.subscribe@hosting.plan:p2?project=j1'

test('a request event is an execute refused for confirmation or run, each once; a read isn’t', () => {
  const calls = [
    call('project', {}, { offers: [] }),
    call(
      'execute',
      { offer, input: { plan: 'p2' } },
      { status: 'refused', code: 'confirmation_required' },
    ),
    call(
      'execute',
      { offer, input: { plan: 'p2' } },
      { status: 'refused', code: 'confirmation_required' },
    ),
    call('execute', { offer: 'x' }, { status: 'refused', code: 'precondition' }),
  ]
  expect(mcpRequestsOf({ calls })).toEqual([{ offer, input: { plan: 'p2' } }])
})

test('completed only when an execute ran while the person accepted its elicitation; the finding is the capability', () => {
  const ran = call('execute', { offer }, { status: 'succeeded' }, 100, 50)
  expect(
    mcpCompleted({
      calls: [ran],
      elicitations: [{ message: 'Move?', at: 120, answer: { action: 'accept' } }],
    }),
  ).toBe(true)
  expect(
    mcpCompleted({
      calls: [ran],
      elicitations: [{ message: 'Move?', at: 120, answer: { action: 'decline' } }],
    }),
  ).toBe(false)
  // an elicitation outside the call is another call's
  expect(
    mcpCompleted({
      calls: [ran],
      elicitations: [{ message: 'Move?', at: 500, answer: { action: 'accept' } }],
    }),
  ).toBe(false)
  expect(declaresElicitation({ clientCapabilities: { elicitation: {} } })).toBe(true)
  expect(declaresElicitation({ clientCapabilities: {} })).toBe(false)
  expect(declaresElicitation({ clientCapabilities: null })).toBe(false)
  expect(
    mcpUnauthorized({
      calls: [call('execute', { offer }, { status: 'refused', code: 'unauthorized' })],
    }),
  ).toBe(true)
})

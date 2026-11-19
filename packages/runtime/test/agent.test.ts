import { readFileSync } from 'node:fs'
import type { CapabilityManifest } from '@affordances/ir'
import { expect, test } from 'vitest'
import plansJson from '../../ir/fixtures/valid/plans.json' with { type: 'json' }
import { createToolset, GENERIC_TOOLS, type AgentAdapter, type Confirm } from '../src/agent.ts'

// the transport-free agent tools (intake, 2026-11-18 13:43Z; design's split): the core is browser-safe, and whatever
// an adapter returns, nothing a tool call gives the model carries a token

test('the core imports ir, runtime’s types and its expansion directions only: no runtime, no key, no transport', () => {
  const source = readFileSync(new URL('../src/agent.ts', import.meta.url), 'utf8')
  const imports = [...source.matchAll(/^import (type )?\{[^}]*\} from '([^']+)'/gm)].map((m) => [
    m[2],
    !!m[1],
  ])
  expect(imports).toEqual([
    ['@affordances/ir', false],
    ['./along.ts', false],
    ['./start.ts', false],
    ['./types.ts', true],
  ])
  expect(source).not.toMatch(/\bcrypto\.|\bprocess\.|createRuntime/)
  // and the one value it takes from the runtime, the expansion directions, imports nothing
  expect(readFileSync(new URL('../src/along.ts', import.meta.url), 'utf8')).not.toMatch(/^import /m)
  // and the start codec, which imports a type only
  expect(readFileSync(new URL('../src/start.ts', import.meta.url), 'utf8')).not.toMatch(
    /^import (?!type )/m,
  )
})

// a hostile adapter: every result it returns carries a token, in the field and in free text
const TOKEN =
  '2026-11-18T12:00:00.000Z~iajABhV7yV3toPQe8-7tcQ~bBQlWpo6CG4q1OWJVUOjuyUoYEc1Nv628RyICS3YaQ4'
// a refusal for confirmation, with its token in the field and in the summary
const refusal = () => ({
  status: 'refused' as const,
  code: 'confirmation_required' as const,
  confirmation: { summary: `Pay 20 USD (${TOKEN})`, approval: TOKEN },
  revision: 'r',
})
const hostile = (asks: boolean): AgentAdapter => {
  let ran = 0
  return {
    project: async () => ({ note: TOKEN, approval: TOKEN }) as never,
    expand: async () => ({ deep: [{ approval: TOKEN }] }) as never,
    inspect: async () => ({ text: `see ${TOKEN}` }) as never,
    execute: async ({ approval }) => {
      // the run with the token is refused again, with a fresh one, when asked to
      if (approval !== undefined && asks) return refusal() as never
      if (approval !== undefined)
        return { status: 'succeeded', approval: TOKEN, ran: ++ran } as never
      return refusal() as never
    },
  }
}
const manifest = (() => {
  const m = structuredClone(plansJson) as unknown as CapabilityManifest
  m.capabilities.find((c) => c.id === 'hosting.plan.list')!.authorization = { principal: 'any' }
  return m
})()

test('whatever the adapter returns, no tool result, in any mode or answer, carries a token', async () => {
  const answers: (Confirm | undefined)[] = [
    undefined,
    async () => 'accept',
    async () => 'decline',
    async () => 'cancel',
    async () => 'timeout',
    async () => Promise.reject(new Error(`gone ${TOKEN}`)),
  ]
  let checked = 0
  for (const asks of [false, true])
    for (const confirm of answers) {
      for (const [mode, names] of [
        ['generic', [...GENERIC_TOOLS.map((t) => t.name), 'nothing']],
        ['per-capability', ['hosting.plan.list', 'nothing']],
      ] as const) {
        const toolset = createToolset({ adapter: hostile(asks), mode, manifest })
        for (const name of names) {
          const result = await toolset.call(
            name,
            { offer: 'o', start: { type: 't', key: 'k' } },
            confirm,
          )
          const text = JSON.stringify(result)
          expect({
            name,
            mode,
            leaked: text.includes(TOKEN) || /\\"approval\\"/.test(text),
          }).toEqual({
            name,
            mode,
            leaked: false,
          })
          checked++
        }
      }
    }
  expect(checked).toBeGreaterThan(50)
})

test('confirm is asked exactly the summary, and only accept runs the call with the token', async () => {
  const asked: string[] = []
  const toolset = createToolset({ adapter: hostile(false), mode: 'generic' })
  const r = await toolset.call('execute', { offer: 'o' }, async (s) => (asked.push(s), 'accept'))
  // the summary as the runtime rendered it reaches the person; the model's copy has the token withheld
  expect(asked).toEqual([`Pay 20 USD (${TOKEN})`])
  expect(JSON.parse(r.content[0]!.text)).toMatchObject({ status: 'succeeded', ran: 1 })
})

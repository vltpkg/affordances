import { createRuntime } from '@affordances/runtime'
import { beforeEach, expect, test } from 'vitest'
import * as trial from '../src/trial.ts'

// the harness's entry point: a trial built from it alone, as a plain node process would

beforeEach(() => trial.reset())

test('a trial projects the permuted plan ids, and the store executes the same assignment', async () => {
  trial.setPlanIds(['p3', 'p1', 'p2'])
  const runtime = createRuntime({ manifest: trial.manifest, resources: trial.resolvers })
  const sid = 's_trial'
  const projection = await runtime.project({ principal: trial.principalFor(sid) })
  const set = projection.choiceSets.find((c) => c.capability === 'hosting.plan.subscribe')!
  // canonical order is by id: p1 is now Pro, p2 Business, p3 Hobby
  expect(set.members).toEqual([
    'hosting.plan.subscribe@hosting.plan:p1',
    'hosting.plan.subscribe@hosting.plan:p2',
    'hosting.plan.subscribe@hosting.plan:p3',
  ])
  const p1 = projection.offers.find((o) => o.id === 'hosting.plan.subscribe@hosting.plan:p1')!
  expect(p1.claims.map((c) => c.id)).toContain('proRecommended')
  // and the store reads the same ids
  const { project } = trial.account(sid)
  const { subscribePlan } = await import('../src/lib/store.ts')
  subscribePlan(sid, project.id, 'p1')
  expect(trial.endState(sid)).toEqual({ plan: 'pro', bundle: null, addOns: [] })
  expect(trial.label(trial.endState(sid))).toBe('pro')
})

test('the trial entry point loads no Next.js module', async () => {
  const { readFileSync } = await import('node:fs')
  const sources = [
    'trial.ts',
    'manifest.ts',
    'catalog.ts',
    'tasks.ts',
    'structure.ts',
    'lib/resolvers.ts',
    'lib/store.ts',
  ]
  for (const file of sources)
    expect(readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')).not.toMatch(
      /from 'next/,
    )
})

import { expect, test } from 'vitest'
import {
  confirmatoryPlan,
  MODELS,
  PER_CELL,
  ROTATIONS,
  TASK,
} from '../results/confirmatory-2026-11-18/run-confirmatory.ts'

// the confirmatory run's order (the pre-registration's amendment, intake 2026-11-18 04:28Z): interleaved, by index,
// with the models alternating and the conditions rotating. The specs, ids and plan-id orders are unchanged

// the 684, built here from the cells alone, as the blocked order had them
const expected = ['claude-sonnet-5-5', 'claude-haiku-5-5'].flatMap((model) =>
  ['A', 'C', 'S'].flatMap((condition) =>
    Array.from({ length: 114 }, (_, index) => ({
      condition,
      task: 'T6',
      model,
      driver: 'claude-cli',
      index,
      id: `conf-${condition}-T6-${model}-${index}`.replace(/[^\w.-]/g, '_'),
    })),
  ),
)
const key = (s: object) => JSON.stringify(s)

test('the order is a permutation of the 684 specs, with their ids and indexes unchanged', () => {
  const plan = confirmatoryPlan()
  expect([MODELS, PER_CELL, TASK]).toEqual([['claude-sonnet-5-5', 'claude-haiku-5-5'], 114, 'T6'])
  expect(plan.length).toBe(684)
  expect(plan.map(key).toSorted()).toEqual(expected.map(key).toSorted())
  expect(new Set(plan.map((s) => s.id)).size).toBe(684)
})

test('each index’s six specs run side by side, models alternating and conditions rotating', () => {
  const plan = confirmatoryPlan()
  for (let i = 0; i < 114; i++) {
    const six = plan.slice(6 * i, 6 * i + 6)
    expect(six.every((s) => s.index === i)).toBe(true)
    // Sonnet first when i is even, Haiku first when it's odd
    const first = i % 2 === 0 ? 'claude-sonnet-5-5' : 'claude-haiku-5-5'
    const second = i % 2 === 0 ? 'claude-haiku-5-5' : 'claude-sonnet-5-5'
    expect(six.map((s) => s.model)).toEqual([first, first, first, second, second, second])
    // within each model, i mod 3: A C S, C S A, S A C
    const rotation = [
      ['A', 'C', 'S'],
      ['C', 'S', 'A'],
      ['S', 'A', 'C'],
    ][i % 3]!
    expect(ROTATIONS[i % 3]).toEqual(rotation)
    expect(six.map((s) => s.condition)).toEqual([...rotation, ...rotation])
  }
})

test('no arm always runs first: each condition leads a third of the indexes', () => {
  const leads = Array.from({ length: 114 }, (_, i) => confirmatoryPlan()[6 * i]!.condition)
  for (const c of ['A', 'C', 'S']) expect(leads.filter((l) => l === c).length).toBe(38)
})

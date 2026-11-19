import { expect, test } from 'vitest'
import {
  CELLS,
  exploratoryPlan,
  sampleOf,
  TOTAL,
} from '../results/exploratory-2026-11-18/run-exploratory.ts'

// the exploratory run's plan (intake's rulings, and the planner, 2026-11-18): the final cells after the canaries, in
// an interleaved order

const SONNET = 'claude-sonnet-5-5'
const HAIKU = 'claude-haiku-5-5'
const OPUS = 'claude-opus-5-5'

test('the plan is the 250 of the final cells, each spec once', () => {
  const plan = exploratoryPlan()
  expect(TOTAL).toBe(250)
  expect(plan.length).toBe(250)
  expect(new Set(plan.map((s) => s.id)).size).toBe(250)
  expect(CELLS.reduce((n, c) => n + c.n, 0)).toBe(250)
  for (const cell of CELLS) {
    const indexes = plan
      .filter((s) => s.condition === cell.condition && s.model === cell.model)
      .map((s) => s.index)
    expect(indexes.toSorted((a, b) => a - b)).toEqual(Array.from({ length: cell.n }, (_, i) => i))
  }
  // Codex is out of this round, and every spec is T6 through claude -p
  expect(plan.every((s) => s.task === 'T6' && s.driver === 'claude-cli')).toBe(true)
})

test('each index’s specs run side by side, alternating models and conditions', () => {
  const plan = exploratoryPlan()
  let at = 0
  for (let i = 0; i < 50; i++) {
    const size = i < 25 ? 6 : 4
    const block = plan.slice(at, at + size)
    at += size
    expect(block.every((s) => s.index === i)).toBe(true)
    const pair = block.filter((s) => s.model !== OPUS)
    const [first, second] = i % 2 === 0 ? [SONNET, HAIKU] : [HAIKU, SONNET]
    const conditions = i % 2 === 0 ? ['C-full-scope', 'A-scope'] : ['A-scope', 'C-full-scope']
    expect(pair.map((s) => `${s.model} ${s.condition}`)).toEqual([
      `${first} ${conditions[0]}`,
      `${first} ${conditions[1]}`,
      `${second} ${conditions[0]}`,
      `${second} ${conditions[1]}`,
    ])
  }
  expect(at).toBe(250)
})

test('Opus’s pair, for indexes 0 to 24, alternates its conditions and rotates its slot', () => {
  const plan = exploratoryPlan()
  for (let i = 0; i < 25; i++) {
    const block = plan.slice(6 * i, 6 * i + 6)
    const opus = block.findIndex((s) => s.model === OPUS)
    expect(opus).toBe([0, 2, 4][i % 3])
    expect(block.slice(opus, opus + 2).map((s) => s.condition)).toEqual(
      i % 2 === 0 ? ['A', 'C-full-scope'] : ['C-full-scope', 'A'],
    )
  }
})

test('the review check’s sample is four of every cell', () => {
  const sample = exploratoryPlan().filter(sampleOf)
  expect(sample.length).toBe(24)
  for (const cell of CELLS)
    expect(
      sample.filter((s) => s.condition === cell.condition && s.model === cell.model).length,
    ).toBe(4)
})

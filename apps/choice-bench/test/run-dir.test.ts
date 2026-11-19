import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, expect, test } from 'vitest'
import { planMismatch, planOfDir } from '../src/run-dir.ts'
import { specsOf } from '../src/surface-plan.ts'

// one plan per run directory (review, 18:42Z): a launch or resume into another plan's directory refuses, and status
// reads the plan from the directory's first launch record

const dir = mkdtempSync(path.join(tmpdir(), 'choice-bench-run-dir-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const at = (name: string) => {
  const d = path.join(dir, name)
  mkdirSync(d, { recursive: true })
  return d
}

test('a launch record names its plan; the pilot’s, written before that field, is the pilot’s', () => {
  expect(planOfDir(at('empty'))).toBeUndefined()
  writeFileSync(path.join(at('old-pilot'), 'launch-1.json'), JSON.stringify({ launch: 1 }))
  expect(planOfDir(path.join(dir, 'old-pilot'))).toBe('pilot')
  writeFileSync(
    path.join(at('re'), 'launch-1.json'),
    JSON.stringify({ launch: 1, plan: 'repilot' }),
  )
  expect(planOfDir(path.join(dir, 're'))).toBe('repilot')
})

test('another plan’s launch, or a trace not in this plan, refuses; its own directory resumes', () => {
  // the pilot's directory, as committed: its launch record predates the plan field
  const pilot = at('pilot-out')
  writeFileSync(path.join(pilot, 'launch-1.json'), JSON.stringify({ launch: 1 }))
  writeFileSync(path.join(pilot, 'pilot-full-T6-claude-sonnet-5-5-0.jsonl'), '{}\n')
  expect(planMismatch(pilot, 'repilot', specsOf('repilot', 'fake'))).toMatch(
    /holds a pilot run, not repilot/,
  )
  expect(planMismatch(pilot, 'confirmatory', specsOf('confirmatory', 'fake'))).toMatch(
    /holds a pilot run, not confirmatory/,
  )
  expect(planMismatch(pilot, 'pilot', specsOf('pilot', 'fake'))).toBeUndefined()
  // no launch record yet, but a stray trace: refused too
  const stray = at('stray')
  writeFileSync(path.join(stray, 'pilot-v0-T6-claude-haiku-5-5-1.jsonl'), '{}\n')
  expect(planMismatch(stray, 'repilot', specsOf('repilot', 'fake'))).toMatch(
    /holds traces that aren't repilot's: pilot-v0/,
  )
  // a fresh directory, and the plan's own, pass
  expect(planMismatch(at('fresh'), 'confirmatory', specsOf('confirmatory', 'fake'))).toBeUndefined()
  const own = at('own')
  writeFileSync(path.join(own, 'launch-1.json'), JSON.stringify({ launch: 1, plan: 'repilot' }))
  writeFileSync(path.join(own, 'repilot-full-T6-claude-sonnet-5-5-0.jsonl'), '{}\n')
  expect(planMismatch(own, 'repilot', specsOf('repilot', 'fake'))).toBeUndefined()
})

test('status reads the plan from the first launch record, and refuses a directory with none', () => {
  const entry = path.join(import.meta.dirname, '..', 'src', 'surface-run.ts')
  const none = spawnSync(process.execPath, [entry, 'status', at('no-launch')], { encoding: 'utf8' })
  expect(none.status).toBe(2)
  expect(none.stderr).toMatch(/no launch record yet/)
  const re = at('re-status')
  writeFileSync(path.join(re, 'launch-1.json'), JSON.stringify({ launch: 1, plan: 'repilot' }))
  const r = spawnSync(process.execPath, [entry, 'status', re], { encoding: 'utf8' })
  expect(r.status).toBe(0)
  // the re-pilot's 16, all pending before its first trial, not the pilot's 60
  const lines = r.stdout.trim().split('\n')
  expect(lines).toHaveLength(17)
  expect(
    lines
      .slice(0, 16)
      .every((l) => JSON.parse(l).state === 'pending' && JSON.parse(l).id.startsWith('repilot-')),
  ).toBe(true)
})

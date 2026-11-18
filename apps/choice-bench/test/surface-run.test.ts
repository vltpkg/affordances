import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, expect, test } from 'vitest'
import { loadGate, ownerChanges, stampOwnerFiles } from '../src/integrity.ts'
import {
  PILOT_MODELS,
  PILOT_SURFACES,
  CONFIRMATORY_SURFACES,
  REPILOT_SURFACES,
  RUN_PLANS,
  surfaceConfirmatoryPlan,
  surfacePilotPlan,
  surfaceRepilotPlan,
} from '../src/surface-plan.ts'
import { APPROVAL, surfaces } from '../src/surfaces.ts'

// M7f's surface run (the planner, 17:35Z): its plan and order, its integrity steps, and its refusal off the pin

const dir = mkdtempSync(path.join(tmpdir(), 'choice-bench-surface-run-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

test('the pilot’s 60: every surface × model × index once, interleaved by index, models alternating, surfaces rotated', () => {
  const plan = surfacePilotPlan()
  expect(plan).toHaveLength(60)
  expect(new Set(plan.map((s) => s.id)).size).toBe(60)
  const cells = new Set(plan.map((s) => `${s.surface} ${s.model} ${s.index}`))
  expect(cells.size).toBe(PILOT_SURFACES.length * PILOT_MODELS.length * 5)
  for (let i = 0; i < 5; i++) {
    const block = plan.slice(i * 12, i * 12 + 12)
    // each index's twelve side by side
    expect(block.every((s) => s.index === i)).toBe(true)
    // Sonnet first when i is even, Haiku when it's odd
    expect(block[0]!.model).toBe(i % 2 === 0 ? 'claude-sonnet-5-5' : 'claude-haiku-5-5')
    // the surfaces rotate one place per index, so each index leads with a different one
    expect(block[0]!.surface).toBe(PILOT_SURFACES[i])
    expect(
      block
        .slice(0, 6)
        .map((s) => s.surface)
        .toSorted(),
    ).toEqual([...PILOT_SURFACES].toSorted())
  }
  expect(plan.every((s) => s.task === 'T6' && s.driver === 'claude-cli')).toBe(true)
  expect(surfacePilotPlan('fake').every((s) => s.driver === 'fake')).toBe(true)
})

test('the owner’s files are stamped by mtime and sha256, and a change is reported, never refused', () => {
  const file = path.join(dir, 'settings.json')
  writeFileSync(file, '{}')
  const before = stampOwnerFiles([file, path.join(dir, 'absent.json')])
  expect(before[1]).toMatchObject({ mtime: null, sha256: null })
  expect(ownerChanges(before, stampOwnerFiles([file, path.join(dir, 'absent.json')]))).toEqual([])
  writeFileSync(file, '{"changed":true}')
  const changes = ownerChanges(before, stampOwnerFiles([file, path.join(dir, 'absent.json')]))
  expect(changes.map((c) => c.file)).toEqual([file])
})

test('the load gate waits until the load is under its limit, records it, and gives up only at its bound', async () => {
  const loads = [40, 35, 12]
  const r = await loadGate({ limit: 32, pollMs: 1, load: () => loads.shift() ?? 12 })
  expect(r).toMatchObject({ limit: 32, load: 12 })
  await expect(loadGate({ limit: 32, pollMs: 1, maxWaitMs: 10, load: () => 50 })).rejects.toThrow(
    /stayed at or above 32/,
  )
})

test('off the pinned export, the entry refuses before any trial: no pin.json, no run', () => {
  const out = path.join(dir, 'unpinned')
  const r = spawnSync(
    process.execPath,
    [path.join(import.meta.dirname, '..', 'src', 'surface-run.ts'), 'pilot', out, '--dry'],
    {
      encoding: 'utf8',
    },
  )
  expect(r.status).toBe(3)
  expect(r.stderr).toMatch(/REFUSED: no pin.json: a surface run runs only from the pinned export/)
  // nothing but its own empty directory: no preflight, no launch record, no trial
  expect(readdirSync(out)).toEqual([])
})

// intake (18:37Z, after the pilot): one approval sentence, the same bytes on every surface's instruction line, and the
// re-pilot's 16
test('every surface’s instruction line ends with the one approval sentence, identical bytes', () => {
  expect(APPROVAL).toBe(
    'The person has approved completing the purchase you judge best; complete it without asking.',
  )
  for (const s of Object.values(surfaces)) expect(s.instruction.endsWith(` ${APPROVAL}`)).toBe(true)
  expect(
    new Set(Object.values(surfaces).map((s) => s.instruction.slice(-APPROVAL.length))).size,
  ).toBe(1)
})

test('the re-pilot: the 4 confirmatory surfaces x 2 models x 2, interleaved, alternating and rotated', () => {
  const plan = surfaceRepilotPlan()
  expect(plan).toHaveLength(16)
  expect(new Set(plan.map((s) => `${s.surface} ${s.model} ${s.index}`)).size).toBe(16)
  expect(new Set(plan.map((s) => s.surface))).toEqual(new Set(REPILOT_SURFACES))
  for (let i = 0; i < 2; i++) {
    const block = plan.slice(i * 8, i * 8 + 8)
    expect(block.every((s) => s.index === i)).toBe(true)
    expect(block[0]!.model).toBe(i % 2 === 0 ? 'claude-sonnet-5-5' : 'claude-haiku-5-5')
    expect(block[0]!.surface).toBe(REPILOT_SURFACES[i])
  }
  expect(plan.every((s) => s.id.startsWith('repilot-'))).toBe(true)
  // the pilot's own ids are as they were, so its committed record still matches its plan
  expect(surfacePilotPlan()[0]!.id).toBe('pilot-full-T6-claude-sonnet-5-5-0')
})

// the planner (18:41Z): the confirmatory run on the re-pilot's pin, through the same entry
test('the confirmatory 400: 4 surfaces x 2 models x 50, interleaved and rotated, each index fixing its plan order', () => {
  const plan = surfaceConfirmatoryPlan()
  expect(plan).toHaveLength(400)
  expect(new Set(plan.map((s) => s.id)).size).toBe(400)
  expect(new Set(plan.map((s) => `${s.surface} ${s.model} ${s.index}`)).size).toBe(400)
  const perCell = new Map<string, number>()
  for (const s of plan)
    perCell.set(`${s.surface} ${s.model}`, (perCell.get(`${s.surface} ${s.model}`) ?? 0) + 1)
  expect([...perCell.values()]).toEqual(Array(8).fill(50))
  for (let i = 0; i < 50; i++) {
    const block = plan.slice(i * 8, i * 8 + 8)
    expect(block.every((s) => s.index === i)).toBe(true)
    expect(block[0]!.model).toBe(i % 2 === 0 ? 'claude-sonnet-5-5' : 'claude-haiku-5-5')
    expect(block[0]!.surface).toBe(CONFIRMATORY_SURFACES[i % 4])
  }
  // its pause is the confirmatory rule, more than 2%, not the pilots' more than 2
  expect(RUN_PLANS.confirmatory.pilot).toBe(false)
  expect([RUN_PLANS.pilot.pilot, RUN_PLANS.repilot.pilot]).toEqual([true, true])
})

test('off the pinned export, every run mode refuses before any trial', () => {
  for (const mode of ['repilot', 'confirmatory']) {
    const out = path.join(dir, `unpinned-${mode}`)
    const r = spawnSync(
      process.execPath,
      [path.join(import.meta.dirname, '..', 'src', 'surface-run.ts'), mode, out, '--dry'],
      {
        encoding: 'utf8',
      },
    )
    expect({ mode, status: r.status }).toEqual({ mode, status: 3 })
    expect(r.stderr).toMatch(/REFUSED: no pin.json/)
    expect(readdirSync(out)).toEqual([])
  }
})

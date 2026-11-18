import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, expect, test } from 'vitest'
import { loadGate, ownerChanges, stampOwnerFiles } from '../src/integrity.ts'
import { PILOT_MODELS, PILOT_SURFACES, surfacePilotPlan } from '../src/surface-plan.ts'

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

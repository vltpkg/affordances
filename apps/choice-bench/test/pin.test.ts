import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, expect, test } from 'vitest'
import { checkPin, PIN_FILE, treeHash } from '../src/pin.ts'
import { refusalsOf } from '../src/preflight.ts'

// the pinned export (the planner, 17:13Z): its whole tree hashed into pin.json, and re-checked at every launch

const root = mkdtempSync(path.join(tmpdir(), 'choice-bench-pin-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))
const tree = () => {
  const at = mkdtempSync(path.join(root, 'tree-'))
  mkdirSync(path.join(at, 'apps', 'hosting-lab', '.next'), { recursive: true })
  writeFileSync(path.join(at, 'apps', 'hosting-lab', '.next', 'BUILD_ID'), 'b1')
  writeFileSync(path.join(at, 'package.json'), '{}')
  mkdirSync(path.join(at, 'node_modules'))
  symlinkSync('../apps/hosting-lab', path.join(at, 'node_modules', 'hosting-lab'))
  return at
}

test('the hash is the tree’s: stable, blind to pin.json, and moved by any edit, new file or retargeted link', () => {
  const at = tree()
  const before = treeHash(at)
  expect(treeHash(at)).toBe(before)
  writeFileSync(path.join(at, PIN_FILE), JSON.stringify({ commit: 'c1', treeHash: before }))
  expect(treeHash(at)).toBe(before)
  writeFileSync(path.join(at, 'apps', 'hosting-lab', '.next', 'BUILD_ID'), 'b2')
  const edited = treeHash(at)
  expect(edited).not.toBe(before)
  writeFileSync(path.join(at, 'extra.txt'), '')
  expect(treeHash(at)).not.toBe(edited)
  const withFile = treeHash(at)
  unlinkSync(path.join(at, 'node_modules', 'hosting-lab'))
  symlinkSync('../elsewhere', path.join(at, 'node_modules', 'hosting-lab'))
  expect(treeHash(at)).not.toBe(withFile)
})

test('checkPin passes the pinned tree, and names the drift otherwise; the preflight refuses a drifted export', () => {
  const at = tree()
  expect(checkPin(at)).toMatchObject({ ok: false, reason: 'no pin.json beside the export' })
  writeFileSync(path.join(at, PIN_FILE), JSON.stringify({ commit: 'c1', treeHash: treeHash(at) }))
  expect(checkPin(at)).toMatchObject({ ok: true, commit: 'c1' })
  writeFileSync(path.join(at, 'package.json'), '{"changed":true}')
  const drift = checkPin(at)
  expect(drift).toMatchObject({ ok: false, commit: 'c1' })
  expect(refusalsOf([], [], undefined, drift)).toEqual([
    `the pinned export has drifted: ${(drift as { reason: string }).reason}`,
  ])
})

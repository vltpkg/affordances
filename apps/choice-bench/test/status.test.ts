import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterAll, expect, test } from 'vitest'
import { archive } from '../src/archive.ts'
import {
  OUTSIDE_GIT,
  ownerChanges,
  readStamps,
  sidecarFor,
  stampOwnerFiles,
} from '../src/integrity.ts'
import { STATUS_FIELDS, statusOf } from '../src/status.ts'
import type { TrialSpec } from '../src/harness.ts'

// row 9647438a's two items (intake, 18:18Z and 18:22Z): the liveness check reads no outcome, and the credential files'
// digests live only in a sidecar outside the results

const dir = mkdtempSync(path.join(tmpdir(), 'choice-bench-status-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const spec = (id: string): TrialSpec =>
  ({
    id,
    condition: 'A',
    surface: 'full',
    task: 'T6',
    model: 'm',
    driver: 'fake',
    index: 0,
  }) as unknown as TrialSpec

test('status prints only its named fields, never an outcome, and never parses a metrics line', () => {
  const out = mkdtempSync(path.join(dir, 'run-'))
  const lines = [
    { kind: 'trial', surface: 'full', model: { requested: 'm', resolved: 'm-1' } },
    { kind: 'call', tool: 'project', response: '{"choice":"pro"}' },
    { kind: 'call', tool: 'execute' },
    { kind: 'end', end: 'final', durationMs: 1234.5, totalTokens: 999, endState: { plan: 'pro' } },
  ]
  // the metrics line, malformed after its prefix: parsing it would throw, so status must skip it unread
  writeFileSync(
    path.join(out, 'scored.jsonl'),
    `${lines.map((l) => JSON.stringify(l)).join('\n')}\n{"kind":"metrics","choice":"pro","completed":true,"optimal":tru\n`,
  )
  writeFileSync(path.join(out, 'running.server.json'), '{}')
  const status = statusOf(out, [spec('scored'), spec('running'), spec('pending')])
  expect(status.map((s) => s.state)).toEqual(['scored', 'running', 'pending'])
  expect(status[0]).toEqual({
    id: 'scored',
    surface: 'full',
    model: 'm',
    faults: 0,
    attempts: 0,
    state: 'scored',
    resolved: 'm-1',
    end: 'final',
    calls: 2,
    durationMs: 1235,
    tokens: 999,
  })
  for (const s of status) for (const key of Object.keys(s)) expect(STATUS_FIELDS).toContain(key)
  const text = JSON.stringify(status)
  for (const word of ['choice', 'completed', 'optimal', 'intended', 'endState', 'endChoice', 'pro'])
    expect(text).not.toContain(word)
})

const HEX64 = /\b[0-9a-f]{64}\b/

test('the credential files’ digests live only in the sidecar, outside the results and their archive, and a change is still found', () => {
  const home = mkdtempSync(path.join(dir, 'home-'))
  const files = ['settings.json', '.credentials.json', 'auth.json'].map((f) => path.join(home, f))
  for (const f of files) writeFileSync(f, `${path.basename(f)} v1`)
  const out = path.join(dir, 'trials', 'run-a')
  mkdirSync(out, { recursive: true })
  const before = sidecarFor(out, 1, 'before')
  const stamps = stampOwnerFiles(files, before)
  // the records' stamps: the two credentials 'recorded outside git', the other digest kept
  expect(stamps.map((s) => [path.basename(s.file), s.sha256 === OUTSIDE_GIT])).toEqual([
    ['settings.json', false],
    ['.credentials.json', true],
    ['auth.json', true],
  ])
  writeFileSync(path.join(out, 'launch-1.json'), JSON.stringify({ stampsBefore: stamps }))
  // the sidecar holds the real digests, and sits beside the results, not in them
  expect(readStamps(before).filter((s) => HEX64.test(String(s.sha256)))).toHaveLength(3)
  expect(path.relative(out, before).startsWith('..')).toBe(true)
  // a credential changed in content, its mtime set back, is still found, and reported without a digest
  const mtime = readStamps(before)[1]!.mtime!
  writeFileSync(files[1]!, '.credentials.json v2')
  execFileSync('touch', ['-d', mtime, files[1]!])
  const after = sidecarFor(out, 1, 'after')
  const endStamps = stampOwnerFiles(files, after)
  const changes = ownerChanges(readStamps(before), readStamps(after))
  expect(changes.map((c) => path.basename(c.file))).toEqual(['.credentials.json'])
  writeFileSync(
    path.join(out, 'end-1.json'),
    JSON.stringify({ stampsAfter: endStamps, ownerChanges: changes }),
  )
  // no record, and nothing in the results' archive, holds either credential digest
  const secrets = [...readStamps(before), ...readStamps(after)]
    .filter((s) => /credentials|auth/.test(s.file))
    .map((s) => s.sha256!)
  for (const f of ['launch-1.json', 'end-1.json']) {
    const text = readFileSync(path.join(out, f), 'utf8')
    for (const h of secrets) expect(text).not.toContain(h)
  }
  const tarball = path.join(dir, 'traces.tar.gz')
  archive(out, tarball, 'nobody@example.invalid')
  const listing = execFileSync('tar', ['-xzOf', tarball], { encoding: 'utf8' })
  for (const h of secrets) expect(listing).not.toContain(h)
})

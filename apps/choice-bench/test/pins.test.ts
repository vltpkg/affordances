import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { checkMcpPin, gitBlobHash } from '../src/pins.ts'

const root = path.join(import.meta.dirname, '..', '..', '..')

test('git’s blob hash, recomputed, is git’s own', () => {
  const bytes = Buffer.from('hello\n')
  expect(gitBlobHash(bytes)).toBe(
    execFileSync('git', ['hash-object', '--stdin'], { input: bytes, encoding: 'utf8' }).trim(),
  )
})

test('the repo’s packages/mcp is main’s, file for file; a changed or missing file is refused', () => {
  expect(checkMcpPin(root)).toMatchObject({ ok: true, differ: [] })
  const copy = mkdtempSync(path.join(tmpdir(), 'choice-bench-pin-'))
  try {
    cpSync(path.join(root, 'packages', 'mcp'), path.join(copy, 'packages', 'mcp'), {
      recursive: true,
    })
    expect(checkMcpPin(copy).ok).toBe(true)
    writeFileSync(path.join(copy, 'packages/mcp/src/server.ts'), '// changed\n', { flag: 'a' })
    rmSync(path.join(copy, 'packages/mcp/src/describe.ts'))
    expect(checkMcpPin(copy)).toMatchObject({
      ok: false,
      differ: [
        { file: 'packages/mcp/src/describe.ts', reason: 'missing' },
        { file: 'packages/mcp/src/server.ts', reason: 'differs' },
      ],
    })
  } finally {
    rmSync(copy, { recursive: true, force: true })
  }
})

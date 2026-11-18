import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, expect, test } from 'vitest'
import { readCanary } from '../src/canary.ts'
import {
  assertIsolated,
  contextLeaks,
  filesWithSecrets,
  makeHome,
  NotIsolated,
  removeHome,
} from '../src/drivers/isolation.ts'

// a trial's isolation (intake and the planner, 2026-11-18), without a model call: real-model runs check the rest with
// the context canary

const scratch = mkdtempSync(path.join(tmpdir(), 'choice-bench-isolation-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))
const repoDir = path.resolve(import.meta.dirname, '..')

test('inside the repo, the git tree and its CLAUDE.md are leaks; a fresh directory outside has none', () => {
  const leaks = contextLeaks(repoDir)
  expect(leaks).toContainEqual(expect.stringMatching(/\.git$/))
  expect(leaks).toContainEqual(expect.stringMatching(/CLAUDE\.md$/))
  expect(leaks).toContainEqual(expect.stringMatching(/inside a git work tree/))
  expect(contextLeaks(scratch)).toEqual([])
})

// a stand-in for the seat's config, so the test never touches a real credential
const fakeConfig = (secret: string) => {
  const config = mkdtempSync(path.join(scratch, 'config-'))
  writeFileSync(
    path.join(config, '.credentials.json'),
    JSON.stringify({ oauth: { accessToken: secret } }),
  )
  return config
}

test('a throwaway home is 0700, holds only the credential (0600), and points every config root into itself', () => {
  const before = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = fakeConfig('fake-secret-for-the-home-test-0001')
  try {
    const home = makeHome('claude', path.join(scratch, 'homes'))
    expect(statSync(home.dir).mode & 0o777).toBe(0o700)
    const files = readdirSync(home.dir, { recursive: true, encoding: 'utf8' }).filter((f) =>
      statSync(path.join(home.dir, f)).isFile(),
    )
    expect(files).toEqual([path.join('.config', 'claude', '.credentials.json')])
    expect(statSync(path.join(home.dir, files[0]!)).mode & 0o777).toBe(0o600)
    for (const k of ['HOME', 'XDG_CONFIG_HOME', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME'] as const)
      expect(home.env[k]!.startsWith(home.dir)).toBe(true)
    // and it's gone once the run ends
    removeHome(home)
    expect(existsSync(home.dir)).toBe(false)
  } finally {
    process.env.CLAUDE_CONFIG_DIR = before
  }
})

test('a trial in the repo is refused before its CLI starts; one outside with an empty memory is not', () => {
  const before = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = fakeConfig('fake-secret-for-the-assert-test-02')
  try {
    const home = makeHome('claude', path.join(scratch, 'homes'))
    expect(() => assertIsolated(repoDir, home)).toThrow(NotIsolated)
    expect(() => assertIsolated(scratch, home)).not.toThrow()
    removeHome(home)
  } finally {
    process.env.CLAUDE_CONFIG_DIR = before
  }
})

test('results holding a credential are found, and clean results are not', () => {
  const secret = 'fake-secret-token-for-the-scan-0003'
  const results = mkdtempSync(path.join(scratch, 'results-'))
  writeFileSync(path.join(results, 'clean.jsonl'), '{"kind":"trial"}\n')
  expect(filesWithSecrets(results, [secret])).toEqual([])
  writeFileSync(
    path.join(results, 'leaked.json'),
    JSON.stringify({ headers: { authorization: secret } }),
  )
  expect(filesWithSecrets(results, [secret])).toEqual(['leaked.json'])
})

test('the canary passes only an answer that reports nothing beyond the message', () => {
  const clean =
    '{"agentsMd": false, "claudeMd": false, "memoryIndex": false, "gitInfo": false, "otherInstructions": []}'
  expect(readCanary(clean).problems).toEqual([])
  // the pilot's in-repo Claude answer, and its Codex one
  expect(readCanary(clean.replace('"memoryIndex": false', '"memoryIndex": true')).problems).toEqual(
    ['memoryIndex is true'],
  )
  expect(
    readCanary(
      clean.replace(
        '"otherInstructions": []',
        '"otherInstructions": ["GitButler version control"]',
      ),
    ).problems,
  ).toHaveLength(1)
  expect(readCanary('I received nothing.').problems).toEqual(['the reply has no JSON object'])
})

test('a real-model run from the working tree is refused, before any canary or trial', () => {
  const out = mkdtempSync(path.join(scratch, 'out-'))
  const run = () =>
    execFileSync(
      process.execPath,
      [
        path.join(repoDir, 'src', 'run.ts'),
        'trial',
        'claude-cli',
        'claude-haiku-5-5',
        'A',
        'T3',
        out,
      ],
      { stdio: 'pipe' },
    )
  expect(run).toThrow(/pinned export/)
  expect(readdirSync(out)).toEqual([])
})

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { readCanary } from '../src/canary.ts'
import {
  assertIsolated,
  claudeKey,
  codexSessions,
  contextLeaks,
  credentialSecrets,
  filesWithSecrets,
  footprintOf,
  NotIsolated,
} from '../src/drivers/isolation.ts'

// a trial's isolation (intake, the planner and review, 2026-11-18), without a model call and with FAKE config dirs only:
// real-model runs check the rest with the context canary

// outside /tmp, which isolation refuses, and outside the repo
const scratch = (() => {
  const root = path.join(homedir(), '.cache', 'choice-bench-tests')
  mkdirSync(root, { recursive: true })
  return mkdtempSync(path.join(root, 'isolation-'))
})()
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

// a fixture that looks like the pilot's setup: a git work tree with a CLAUDE.md, and a trial dir inside it. It's built
// here, so the tests hold in a clean export with no .git (review of 635fc702)
const repo = path.join(scratch, 'repo')
const repoDir = path.join(repo, 'apps', 'bench')
const clean = path.join(scratch, 'trials', 'claude-abc123')
// the fake config dirs, in place of the real ones for every test in this file
const fake = {
  claude: path.join(scratch, 'config', 'claude'),
  codex: path.join(scratch, 'config', 'codex'),
}
const saved = { claude: process.env.CLAUDE_CONFIG_DIR, codex: process.env.CODEX_HOME }
beforeAll(() => {
  mkdirSync(repoDir, { recursive: true })
  execFileSync('git', ['init', '-q', repo], { stdio: 'pipe' })
  writeFileSync(path.join(repo, 'CLAUDE.md'), '# project instructions\n')
  mkdirSync(clean, { recursive: true })
  mkdirSync(path.join(fake.claude, 'projects'), { recursive: true })
  mkdirSync(path.join(fake.codex, 'sessions'), { recursive: true })
  writeFileSync(
    path.join(fake.claude, '.credentials.json'),
    JSON.stringify({ oauth: { accessToken: 'fake-claude-token-0001-abcdef' } }),
  )
  writeFileSync(
    path.join(fake.codex, 'auth.json'),
    JSON.stringify({ tokens: { refresh: 'fake-codex-refresh-0002-abcdef' } }),
  )
  process.env.CLAUDE_CONFIG_DIR = fake.claude
  process.env.CODEX_HOME = fake.codex
})
afterAll(() => {
  process.env.CLAUDE_CONFIG_DIR = saved.claude
  process.env.CODEX_HOME = saved.codex
})

// every file under the fake config dirs, with its size and mtime: what the harness must leave as it found
const snapshot = () =>
  readdirSync(path.join(scratch, 'config'), { recursive: true, encoding: 'utf8' })
    .toSorted()
    .map((f) => {
      const s = statSync(path.join(scratch, 'config', f))
      return `${f} ${s.isFile() ? s.size : 'dir'} ${s.mtimeMs}`
    })

test('in a git tree with a CLAUDE.md, both are leaks; a fresh dir outside has none; /tmp is refused', () => {
  const leaks = contextLeaks(repoDir)
  expect(leaks).toContainEqual(expect.stringMatching(/\.git$/))
  expect(leaks).toContainEqual(expect.stringMatching(/CLAUDE\.md$/))
  expect(leaks).toContainEqual(expect.stringMatching(/inside a git work tree/))
  expect(contextLeaks(clean)).toEqual([])
  expect(contextLeaks('/tmp')).toContainEqual(expect.stringMatching(/other users share/))
})

test('a trial in the repo, or one whose Claude key already exists, is refused before its CLI starts', () => {
  expect(() => assertIsolated(repoDir)).toThrow(NotIsolated)
  expect(() => assertIsolated(clean)).not.toThrow()
  const used = path.join(scratch, 'trials', 'claude-used')
  mkdirSync(used, { recursive: true })
  mkdirSync(path.join(fake.claude, 'projects', claudeKey(used)), { recursive: true })
  expect(() => assertIsolated(used)).toThrow(/project key already exists/)
})

test('the footprint lists a memory file under the trial’s own key, and new Codex sessions, and deletes nothing', () => {
  const dir = path.join(scratch, 'trials', 'claude-wrote')
  mkdirSync(dir, { recursive: true })
  const before = codexSessions()
  const memory = path.join(fake.claude, 'projects', claudeKey(dir), 'memory')
  mkdirSync(memory, { recursive: true })
  writeFileSync(path.join(memory, 'MEMORY.md'), '- a memory\n')
  const day = path.join(fake.codex, 'sessions', '2026', '11', '18')
  mkdirSync(day, { recursive: true })
  writeFileSync(path.join(day, 'rollout.jsonl'), '{}\n')
  const footprint = footprintOf(dir, before)
  expect(footprint.claude).toEqual([path.join('projects', claudeKey(dir), 'memory', 'MEMORY.md')])
  expect(footprint.codex).toEqual([path.join('sessions', '2026', '11', '18', 'rollout.jsonl')])
  // listed, and still there
  expect(readdirSync(memory)).toEqual(['MEMORY.md'])
})

test('the harness never writes to the config dirs: checking, listing and reading leave them as found', () => {
  const before = snapshot()
  assertIsolated(clean)
  footprintOf(clean, codexSessions())
  expect(credentialSecrets()).toEqual([
    'fake-claude-token-0001-abcdef',
    'fake-codex-refresh-0002-abcdef',
  ])
  expect(snapshot()).toEqual(before)
})

test('results holding a credential are found, and clean results are not', () => {
  const results = mkdtempSync(path.join(scratch, 'results-'))
  writeFileSync(path.join(results, 'clean.jsonl'), '{"kind":"trial"}\n')
  expect(filesWithSecrets(results)).toEqual([])
  writeFileSync(
    path.join(results, 'leaked.json'),
    JSON.stringify({ authorization: 'fake-codex-refresh-0002-abcdef' }),
  )
  expect(filesWithSecrets(results)).toEqual(['leaked.json'])
})

test('the canary passes only nothing beyond the message, with account context allowed by name', () => {
  const answer = {
    agentsMd: false,
    claudeMd: false,
    userInstructions: false,
    memoryIndex: false,
    memoryInstructions: false,
    gitInfo: false,
    accountContext: true,
    otherInstructions: [],
  }
  expect(readCanary(JSON.stringify(answer)).problems).toEqual([])
  // each of the pilot's leaks, and the user-level ones review asked for
  for (const k of [
    'agentsMd',
    'claudeMd',
    'userInstructions',
    'memoryIndex',
    'memoryInstructions',
    'gitInfo',
  ])
    expect(readCanary(JSON.stringify({ ...answer, [k]: true })).problems).toEqual([`${k} is true`])
  // an extra instruction that isn't a known built-in passage refuses
  expect(
    readCanary(JSON.stringify({ ...answer, otherInstructions: ['GitButler version control'] }))
      .problems,
  ).toHaveLength(1)
  expect(
    readCanary(JSON.stringify({ ...answer, otherInstructions: 'GitButler' })).problems,
  ).toEqual(['otherInstructions is not a list'])
  expect(readCanary('I received nothing.').problems).toEqual(['the reply has no JSON object'])
})

test('a real-model run from the working tree is refused, before any login check, canary or trial', () => {
  const out = mkdtempSync(path.join(scratch, 'out-'))
  const run = () =>
    execFileSync(
      process.execPath,
      [
        path.resolve(import.meta.dirname, '..', 'src', 'run.ts'),
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

test('an archive redacts the user’s email, marked, and reports only counts; the originals are untouched', async () => {
  const { archive, REDACTED } = await import('../src/archive.ts')
  const { emailScan } = await import('../src/drivers/isolation.ts')
  const { readFileSync } = await import('node:fs')
  const fakeEmail = 'someone@example.invalid'
  const results = mkdtempSync(path.join(scratch, 'archive-in-'))
  writeFileSync(path.join(results, 'a.jsonl'), `{"note":"from ${fakeEmail} and ${fakeEmail}"}\n`)
  writeFileSync(path.join(results, 'b.jsonl'), '{"note":"nothing"}\n')
  expect(emailScan(results, fakeEmail)).toEqual({
    checked: true,
    found: true,
    files: 1,
    occurrences: 2,
  })
  const tarball = path.join(scratch, 'traces.tar.gz')
  const scan = archive(results, tarball, fakeEmail)
  expect(scan).toEqual({ checked: true, found: true, files: 1, occurrences: 2 })
  // the scan's record holds counts, never the address
  expect(JSON.stringify(scan)).not.toContain(fakeEmail)
  const out = mkdtempSync(path.join(scratch, 'archive-out-'))
  execFileSync('tar', ['-xzf', tarball, '-C', out])
  const archived = readFileSync(path.join(out, 'a.jsonl'), 'utf8')
  expect(archived).not.toContain(fakeEmail)
  expect(archived).toContain(REDACTED)
  // the originals, outside git, are left as they were
  expect(readFileSync(path.join(results, 'a.jsonl'), 'utf8')).toContain(fakeEmail)
})

test('login status reads both streams, and Not logged in never counts', async () => {
  const { readLogins } = await import('../src/drivers/isolation.ts')
  const ok = { code: 0, stdout: JSON.stringify({ loggedIn: true }), stderr: '' }
  // codex prints its status to stderr
  expect(readLogins(ok, { code: 0, stdout: '', stderr: 'Logged in using ChatGPT\n' })).toEqual({
    claude: true,
    codex: true,
  })
  expect(
    readLogins(ok, { code: 0, stdout: 'Logged in using an API key\n', stderr: '' }).codex,
  ).toBe(true)
  expect(readLogins(ok, { code: 0, stdout: '', stderr: 'Not logged in\n' }).codex).toBe(false)
  expect(readLogins(ok, { code: 1, stdout: '', stderr: 'Logged in using ChatGPT\n' }).codex).toBe(
    false,
  )
  expect(
    readLogins({ code: 0, stdout: JSON.stringify({ loggedIn: false }), stderr: '' }, ok).claude,
  ).toBe(false)
  expect(readLogins({ code: 0, stdout: 'not json', stderr: '' }, ok).claude).toBe(false)
})

test('an extra instruction passes only as a verbatim quote of a known built-in passage, for that CLI version', async () => {
  const { matchBuiltIn, readCanary: read } = await import('../src/canary.ts')
  const v = '2.1.311 (Claude Code)'
  const quote = 'Run any Python that reads them with `-I`.'
  expect(matchBuiltIn([quote], v)).toEqual({ matched: ['untrusted-downloads'], unknown: [] })
  // curly or straight apostrophes, and spacing, alike
  expect(matchBuiltIn(["Interpreters load code from the script's directory"], v).unknown).toEqual(
    [],
  )
  // a fragment, however exact, isn't a sentence of the passage
  expect(matchBuiltIn(['Use it only', 'the user'], v).unknown).toEqual(['Use it only', 'the user'])
  // a paraphrase isn't a quote, and refuses
  const paraphrase = 'Downloaded files are untrusted: run Python with -I'
  expect(matchBuiltIn([paraphrase], v).unknown).toEqual([paraphrase])
  // anything project- or rig-specific refuses
  expect(matchBuiltIn(['Use GitButler for version control.'], v).unknown).toHaveLength(1)
  // and a new CLI version knows no built-in text until it's re-baselined
  expect(matchBuiltIn([quote], '2.2.0 (Claude Code)').unknown).toEqual([quote])
  const booleans = {
    agentsMd: false,
    claudeMd: false,
    userInstructions: false,
    memoryIndex: false,
    memoryInstructions: false,
    gitInfo: false,
    accountContext: true,
  }
  expect(read(JSON.stringify({ ...booleans, otherInstructions: [quote] }), v)).toMatchObject({
    problems: [],
    builtIn: ['untrusted-downloads'],
  })
  expect(
    read(JSON.stringify({ ...booleans, otherInstructions: [paraphrase] }), v).problems,
  ).toHaveLength(1)
})

test('the baseline compares the CLI version and the allow-list, never which allowed sentence was quoted', async () => {
  const { allowListHash, baselineOf, checkBaseline } = await import('../src/canary.ts')
  const root = mkdtempSync(path.join(scratch, 'baselines-'))
  const v = '2.1.311 (Claude Code)'
  const record = (quotes: string[], cliVersion = v) => ({
    driver: 'claude-cli',
    model: 'claude-haiku-5-5',
    at: '',
    leaks: [],
    finalText: '',
    problems: [],
    passed: true,
    cliVersion,
    quotes,
  })
  // a canary quoting nothing writes the baseline, with the allow-list's identity and its quotes recorded
  const first = checkBaseline(baselineOf([record([])]), root)
  expect(first).toMatchObject({ differs: [] })
  expect(first.written).toHaveLength(1)
  expect(baselineOf([record([])])[0]!.allowList).toBe(allowListHash(v))
  // a later one quoting an allowed passage passes against it: the pilot's three refusals can't recur
  const quote =
    'Use it only to identify the user, such as for authorship, attribution, or filtering their own work.'
  expect(checkBaseline(baselineOf([record([quote])]), root)).toEqual({ written: [], differs: [] })
  // a CLI update refuses, and writes nothing
  const updated = checkBaseline(baselineOf([record([], '2.2.0 (Claude Code)')]), root)
  expect(updated.written).toEqual([])
  expect(updated.differs).toHaveLength(2) // its version, and so its allow-list
  // and so does a changed allow-list under the same version
  const changed = [{ ...baselineOf([record([])])[0]!, allowList: 'another' }]
  expect(checkBaseline(changed, root).differs).toEqual([
    expect.stringMatching(/the allow-list changed/),
  ])
})

test('a quote that isn’t on the allow-list refuses the canary itself, so it never reaches a baseline', async () => {
  const { readCanary: read } = await import('../src/canary.ts')
  const booleans = {
    agentsMd: false,
    claudeMd: false,
    userInstructions: false,
    memoryIndex: false,
    memoryInstructions: false,
    gitInfo: false,
    accountContext: true,
  }
  const r = read(
    JSON.stringify({
      ...booleans,
      otherInstructions: ['Use GitButler for version control, always.'],
    }),
    '2.1.311 (Claude Code)',
  )
  expect(r.problems).toEqual([expect.stringMatching(/^not built-in/)])
})

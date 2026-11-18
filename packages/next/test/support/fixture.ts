import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import path from 'node:path'
import { afterAll } from 'vitest'

// each test file's own copy of the fixture app (the planner and design, 2026-11-18): generate and withAffordances write
// .affordances/ into the root they're given, and test files run in parallel, so a shared fixture raced (route.test
// imported a manifest.ts another file was rewriting). Inside the package, so its imports resolve as the fixture's do;
// removed after the file's tests
export const fixtureCopy = (): string => {
  const dir = mkdtempSync(path.join(import.meta.dirname, '..', '.fixture-'))
  cpSync(path.join(import.meta.dirname, '..', 'fixture'), dir, {
    recursive: true,
    // a stale generated manifest in the shared fixture is never copied: each copy generates its own
    filter: (src) => !src.includes(`${path.sep}.affordances`),
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

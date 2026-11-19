import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { BrowserRecord } from '../src/browser-server.ts'
import { adapterOf, stallOf } from '../src/surface-adapters.ts'
import { surfaces } from '../src/surfaces.ts'
import type { WebMcpRecord } from '../src/webmcp-server.ts'

// the generic harnessFaults list is new; every record archived before it keeps errors and stalls, and must read to
// the same faults and the same stall as the runner read from those fields when it ran

const RESULTS = path.resolve(import.meta.dirname, '..', 'results')
const work = mkdtempSync(path.join(tmpdir(), 'record-faults-'))
afterAll(() => rmSync(work, { recursive: true, force: true }))

const filesUnder = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? filesUnder(path.join(dir, e.name)) : [path.join(dir, e.name)],
  )

// every committed browser and WebMCP server record, set-aside attempts in interrupted/ included
const archived = () => {
  const records: { file: string; record: BrowserRecord | WebMcpRecord }[] = []
  for (const tarball of filesUnder(RESULTS).filter((f) => f.endsWith('traces.tar.gz'))) {
    const into = mkdtempSync(path.join(work, 'run-'))
    execFileSync('tar', ['xzf', tarball, '-C', into])
    for (const file of filesUnder(into).filter((f) => f.endsWith('.server.json'))) {
      const record = JSON.parse(readFileSync(file, 'utf8')) as { surface?: string }
      if (record.surface === 'browser' || record.surface === 'webmcp')
        records.push({ file: path.relative(work, file), record: record as BrowserRecord })
    }
  }
  return records
}

// the runner's stall before the list, as it read each surface's own fields
const legacyStall = (record: BrowserRecord | WebMcpRecord) => {
  if (record.surface === 'webmcp')
    return record.errors?.length
      ? {
          kind: 'stall',
          detail: `the page's tools failed: ${record.errors.map((e) => e.detail).join('; ')}`,
        }
      : undefined
  return record.errors?.length
    ? {
        kind: 'stall',
        detail: `the browser failed: ${record.errors.map((e) => e.detail).join('; ')}`,
      }
    : record.stalls?.length
      ? {
          kind: 'stall',
          detail: `a ref from the preceding snapshot didn't resolve: ${record.stalls.map((s) => `${s.tool} ${s.ref}`).join(', ')}`,
        }
      : undefined
}

describe("a record's harness faults", () => {
  it('reads every archived record from its old fields, to the stall the runner read then', () => {
    const records = archived()
    // M7f's pilot, re-pilot and confirmatory runs and T8's pilot hold browser and WebMCP records
    expect(records.length).toBeGreaterThan(100)
    let withFaults = 0
    for (const { file, record } of records) {
      const faults = adapterOf(surfaces[record.surface]).faults(record as never)
      const old = [...(record.errors ?? []), ...((record as BrowserRecord).stalls ?? [])]
      // the file names the record on a failure
      expect({ file, faults: faults.length }).toEqual({ file, faults: old.length })
      expect({ file, stall: stallOf(faults) }).toEqual({ file, stall: legacyStall(record) })
      if (old.length) withFaults++
    }
    // a negative control on the comparison: at least one archived record has a fault to read
    expect(withFaults).toBeGreaterThan(0)
  })

  it('reads a new record from its list, by kind', () => {
    const browser = adapterOf(surfaces.browser)
    const ref = { kind: 'ref' as const, call: 2, tool: 'click', ref: 'e7', detail: 'timeout' }
    const failed = { kind: 'browser' as const, call: 3, tool: 'open', detail: 'crashed' }
    expect(browser.faults({ harnessFaults: [ref] } as never)).toEqual([ref])
    expect(stallOf([ref])).toEqual({
      kind: 'stall',
      detail: "a ref from the preceding snapshot didn't resolve: click e7",
    })
    // the browser itself failing comes before a stale ref, as before
    expect(stallOf([ref, failed])?.detail).toBe('the browser failed: crashed')
    const page = { kind: 'page-tools' as const, call: 0, tool: 'wait', detail: 'no tools' }
    expect(adapterOf(surfaces.webmcp).faults({ harnessFaults: [page] } as never)).toEqual([page])
    expect(stallOf([page])?.detail).toBe("the page's tools failed: no tools")
    expect(stallOf([])).toBeUndefined()
  })
})

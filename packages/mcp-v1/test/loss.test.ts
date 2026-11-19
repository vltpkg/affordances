import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { CapabilityManifest } from '@affordances/ir'
import { expect, test } from 'vitest'
import plansJson from '../../ir/fixtures/valid/plans.json' with { type: 'json' }
import { lossReport } from '../src/index.ts'

// assumption 9, measured (RFC 0004 §6): what the per-capability mode keeps of each capability, field by field, on the
// plans fixture and on hosting-lab's real manifest. The reports are checked in, and this test regenerates them: a
// change in what MCP keeps shows as a difference. UPDATE_LOSS=1 rewrites them

const hostingLab = async () =>
  (
    (await import(
      path.join(
        import.meta.dirname,
        '..',
        '..',
        '..',
        'apps',
        'hosting-lab',
        'src',
        'app',
        'capabilities.ts',
      )
    )) as { manifest: CapabilityManifest }
  ).manifest

test.each([
  ['plans', async () => plansJson as unknown as CapabilityManifest],
  ['hosting-lab', hostingLab],
] as const)('the %s manifest’s loss report is the one checked in', async (name, load) => {
  const report = lossReport(await load())
  const file = path.join(import.meta.dirname, '..', 'loss', `${name}.json`)
  if (process.env.UPDATE_LOSS === '1' || !existsSync(file))
    writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`)
  // compared as values, so the formatter may lay the file out as it likes
  expect(report).toEqual(JSON.parse(readFileSync(file, 'utf8')))
})

test('a capability no one but a signed-in caller may use has no tool, so everything it declares is lost', async () => {
  const { perCapability } = lossReport(await hostingLab())
  for (const row of perCapability.rows.filter((r) => !r.exported))
    expect(new Set(Object.values(row.fields))).toEqual(new Set(['lost']))
  // and an exported one keeps its id, description and input, and has the runtime's checks at call time
  for (const row of perCapability.rows.filter((r) => r.exported))
    expect(row.fields).toMatchObject({ id: 'carried', description: 'carried' })
})

// the review check's reference (intake, 2026-11-18): c81eeeb1's own runTrial on the runner's sample of the 684, with
// the fake driver. Compare its records with the runner's --fake run using compare.py.
//   node reference.ts <export dir> <out dir> <run-confirmatory.ts>
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const [exportDir, out, runner] = process.argv.slice(2) as [string, string, string]
const src = path.join(exportDir, 'apps', 'choice-bench', 'src')
const { runTrial } = await import(pathToFileURL(path.join(src, 'harness.ts')).href)
const { fakeDriver } = await import(pathToFileURL(path.join(src, 'drivers', 'fake.ts')).href)
const { confirmatoryPlan, SAMPLE_INDEXES } = await import(pathToFileURL(path.resolve(runner)).href)
for (const s of confirmatoryPlan().filter((c: { index: number }) => SAMPLE_INDEXES.has(c.index)))
  await runTrial(s, fakeDriver(s.index, path.join(out, `${s.id}.raw.json`)), out)

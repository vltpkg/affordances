// the review check's reference: the patched c81eeeb1 export's own runTrial on the runner's sample of the 250, with the
// fake driver. Compare its records with the runner's --fake run using ../../confirmatory-2026-11-18/review-check/compare.py.
//   node reference.ts <patched export dir> <out dir> <run-exploratory.ts>
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const [exportDir, out, runner] = process.argv.slice(2) as [string, string, string]
const src = path.join(exportDir, 'apps', 'choice-bench', 'src')
const { runTrial } = await import(pathToFileURL(path.join(src, 'harness.ts')).href)
const { fakeDriver } = await import(pathToFileURL(path.join(src, 'drivers', 'fake.ts')).href)
const { exploratoryPlan, sampleOf } = await import(pathToFileURL(path.resolve(runner)).href)
for (const s of exploratoryPlan().filter(sampleOf))
  await runTrial(s, fakeDriver(s.index, path.join(out, `${s.id}.raw.json`)), out)

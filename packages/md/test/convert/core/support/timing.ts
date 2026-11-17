import os from 'node:os'

// timing ratios that hold on a loaded machine. Load only ever adds time, so each size's cost is the least of N runs,
// the sizes taken in turn so a load that comes and goes slows both alike. A ratio over its limit is measured again
// with more runs (3, then 9, then 27), which a real quadratic stays over every time and a busy moment doesn't. A
// passing ratio costs what it did: three runs a size
const RUNS = [3, 9, 27]

// intake's rule for a check only the clock can fail: on a machine busier than one runnable task per core, it's
// skipped, saying so and naming the load, and never under CI, where a slow run is a real finding. Everything else the
// test checks still runs
export const busy = () => !process.env.CI && os.loadavg()[0]! / os.availableParallelism() > 1
const skipped = (what: string) =>
  console.warn(
    `[md] skipped the timing check ${JSON.stringify(what)}: load ${os.loadavg()[0]!.toFixed(1)} on ${os.availableParallelism()} cores (CI never skips)`,
  )
export const clockCheck = (what: string, check: () => void) => {
  if (busy()) skipped(what)
  else check()
}

// on a busy machine, the large case runs once, for what the test checks of its output, and the ratio is 0: skipped
export const leastRatio = (small: () => number, large: () => number, limit: number) => {
  if (busy()) {
    large()
    skipped(`a ratio under ${limit}`)
    return 0
  }
  let ratio = Infinity
  for (const runs of RUNS) {
    let a = Infinity
    let b = Infinity
    for (let run = 0; run < runs; run++) {
      a = Math.min(a, small())
      b = Math.min(b, large())
    }
    ratio = Math.min(ratio, b / a)
    if (ratio < limit) break
  }
  return ratio
}

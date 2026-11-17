// timing ratios that hold on a loaded machine. Load only ever adds time, so each size's cost is the least of N runs,
// the sizes taken in turn so a load that comes and goes slows both alike. A ratio over its limit is measured again
// with more runs (3, then 9, then 27), which a real quadratic stays over every time and a busy moment doesn't. A
// passing ratio costs what it did: three runs a size
const RUNS = [3, 9, 27]

export const leastRatio = (small: () => number, large: () => number, limit: number) => {
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

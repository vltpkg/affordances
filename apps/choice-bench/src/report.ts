import type { runTrial } from './harness.ts'

// the pilot's report (§8, row 80a8328d's fields): per cell, its trials' tokens, cap hits and the variance of the
// outcomes the confirmatory run is sized on; across cells, A's inspect rate and the Codex spawn rate
type Result = Awaited<ReturnType<typeof runTrial>>

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
// the sample variance: what sizing the confirmatory run reads
const variance = (xs: number[]) => {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1)
}
const share = (rs: Result[], p: (r: Result) => boolean) =>
  rs.length ? rs.filter(p).length / rs.length : null

// the distribution of a cell's or condition's token use: what discovery cost (intake, 2026-11-18)
const quantile = (sorted: number[], q: number) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]! : 0
const distribution = (xs: number[]) => {
  const s = xs.toSorted((a, b) => a - b)
  return {
    min: s[0] ?? 0,
    p25: quantile(s, 0.25),
    median: quantile(s, 0.5),
    p75: quantile(s, 0.75),
    max: s.at(-1) ?? 0,
  }
}

export const pilotReport = (results: Result[]) => {
  const cells = new Map<string, Result[]>()
  for (const r of results) {
    const key = `${r.spec.condition} ${r.spec.task} ${r.spec.model}`
    cells.set(key, [...(cells.get(key) ?? []), r])
  }
  const tokens = results.map((r) => r.metrics.tokens)
  return {
    trials: results.length,
    tokens: { total: tokens.reduce((a, b) => a + b, 0), meanPerTrial: mean(tokens) },
    capHits: Object.fromEntries(
      ['calls', 'turns', 'tokens', 'time'].map((k) => [
        k,
        results.filter((r) => r.capHits.includes(k)).length,
      ]),
    ),
    aborted: results.filter((r) => r.end === 'aborted').length,
    traceMismatches: results.filter((r) => r.traceMismatch).length,
    // A's trials that inspected at least once: how often the omitted claims were one call away and taken (§3.1)
    aInspectRate: share(
      results.filter((r) => r.spec.condition === 'A'),
      (r) => r.metrics.inspected,
    ),
    codexSpawnRate: share(
      results.filter((r) => r.spec.driver === 'codex-cli'),
      (r) => r.spawned,
    ),
    tokenCap:
      'input + output + cache writes, cache reads excluded, at 150,000 (intake, 2026-11-18)',
    // per condition, across its models and tasks: the rates intake decides on (capped above 5%, none above 10%)
    conditions: [...new Set(results.map((r) => r.spec.condition))].map((condition) => {
      const rs = results.filter((r) => r.spec.condition === condition)
      const uncapped = rs.filter((r) => r.end !== 'capped')
      return {
        condition,
        n: rs.length,
        cappedRate: share(rs, (r) => r.end === 'capped'),
        noneRate: share(rs, (r) => r.metrics.choseNone),
        completionRate: share(rs, (r) => r.metrics.completed),
        switching: rs.filter((r) => r.metrics.switched).length,
        // a switch to the optimum within a decision; under E, the friction-recovery rate
        correctedAfterDiscovery: share(rs, (r) => r.metrics.correctedAfterDiscovery),
        // intent to treat, the primary: capped trials count as not optimal
        optimal: share(rs, (r) => r.metrics.optimal),
        // the sensitivity analysis: capped trials left out
        optimalCappedExcluded: share(uncapped, (r) => r.metrics.optimalChoice),
        tokens: distribution(rs.map((r) => r.metrics.tokens)),
      }
    }),
    cells: [...cells].map(([cell, rs]) => {
      const optimal = rs.map((r) => (r.metrics.optimal ? 1 : 0))
      const susceptible = rs.map((r) => (r.metrics.susceptible ? 1 : 0))
      return {
        cell,
        n: rs.length,
        optimal: mean(optimal),
        optimalVariance: variance(optimal),
        susceptible: mean(susceptible),
        susceptibleVariance: variance(susceptible),
        tokensMean: mean(rs.map((r) => r.metrics.tokens)),
        tokensVariance: variance(rs.map((r) => r.metrics.tokens)),
        capped: rs.filter((r) => r.end === 'capped').length,
        choices: Object.fromEntries(
          [...new Set(rs.map((r) => r.metrics.choice))].map((c) => [
            c,
            rs.filter((r) => r.metrics.choice === c).length,
          ]),
        ),
      }
    }),
  }
}

import type { runTrial } from './harness.ts'

// the pilot's report (§8, and intake's runbook): per condition and model, the outcomes, their intervals and
// variance, discovery's cost and latency with the host's load; across them, cap hits, failures and the run's metadata
export type Result = Awaited<ReturnType<typeof runTrial>>
export type Failed = { spec: Result['spec']; failed: string }

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
// the sample variance: what sizing the confirmatory run reads
const variance = (xs: number[]) => {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1)
}
const share = (rs: Result[], p: (r: Result) => boolean) =>
  rs.length ? rs.filter(p).length / rs.length : null
// a proportion with its 95% Wilson interval, which holds at five trials and at 0 or 1
const rate = (rs: Result[], p: (r: Result) => boolean) => {
  const n = rs.length
  if (!n) return { k: 0, n, rate: null, ci95: null }
  const k = rs.filter(p).length
  const z = 1.96
  const phat = k / n
  const centre = (phat + (z * z) / (2 * n)) / (1 + (z * z) / n)
  const half = (z * Math.sqrt((phat * (1 - phat)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n)
  return { k, n, rate: phat, ci95: [Math.max(0, centre - half), Math.min(1, centre + half)] }
}
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
    mean: mean(s),
    variance: variance(s),
  }
}
const counts = (xs: string[]) =>
  Object.fromEntries([...new Set(xs)].toSorted().map((x) => [x, xs.filter((y) => y === x).length]))

const group = (rs: Result[]) => {
  const optimal = rs.map((r) => (r.metrics.optimal ? 1 : 0))
  const uncapped = rs.filter((r) => r.end !== 'capped')
  const claims = [...new Set(rs.flatMap((r) => r.metrics.claimExposure.map((c) => c.claim)))]
  return {
    n: rs.length,
    choices: counts(rs.map((r) => r.metrics.choice)),
    // intent to treat, the primary: a capped trial isn't optimal
    optimal: rate(rs, (r) => r.metrics.optimal),
    // the sensitivity analysis: capped trials left out
    optimalCappedExcluded: rate(uncapped, (r) => r.metrics.optimalChoice),
    // the variance of the primary outcome, for sizing the confirmatory run
    optimalVariance: variance(optimal),
    susceptible: rate(rs, (r) => r.metrics.susceptible),
    none: rate(rs, (r) => r.metrics.choseNone),
    capped: rate(rs, (r) => r.end === 'capped'),
    // a driver failure on both attempts, reported per cell (intake, 2026-11-18 12:05Z)
    failed: rate(rs, (r) => r.end === 'failed'),
    completed: rate(rs, (r) => r.metrics.completed),
    switching: rate(rs, (r) => r.metrics.switched),
    correctedAfterDiscovery: rate(rs, (r) => r.metrics.correctedAfterDiscovery),
    inspected: rate(rs, (r) => r.metrics.inspected),
    // each owner claim: the share of trials a response showed it to before the choice
    claimExposure: Object.fromEntries(
      claims.map((c) => [
        c,
        share(rs, (r) => r.metrics.claimExposure.some((e) => e.claim === c && e.exposed)),
      ]),
    ),
    tokens: distribution(rs.map((r) => r.metrics.tokens)),
    cacheReadTokens: distribution(rs.map((r) => r.metrics.cacheReadTokens)),
    cacheWriteTokens: distribution(rs.map((r) => r.metrics.cacheWriteTokens)),
    turns: distribution(rs.flatMap((r) => (r.turns === null ? [] : [r.turns]))),
    calls: distribution(rs.map((r) => r.metrics.calls)),
    // latency beside the host's load at each trial's start (every user's)
    durationMs: distribution(rs.map((r) => r.metrics.durationMs)),
    load: distribution(rs.map((r) => r.load)),
    traceMismatches: rs.filter((r) => r.traceMismatch).length,
    spawned: rs.filter((r) => r.spawned).length,
  }
}

export const pilotReport = (results: Result[], failed: Failed[] = []) => {
  const cells = new Map<string, Result[]>()
  for (const r of results) {
    const key = `${r.spec.condition} ${r.spec.task} ${r.spec.model}`
    cells.set(key, [...(cells.get(key) ?? []), r])
  }
  return {
    trials: results.length + failed.length,
    scored: results.length,
    // a failed trial is reported, never re-run without intake's OK
    failed: failed.map((f) => ({ id: f.spec.id, reason: f.failed })),
    tokenCap:
      'input + output + cache writes, cache reads excluded, at 150,000 (intake, 2026-11-18)',
    capHits: Object.fromEntries(
      ['calls', 'turns', 'tokens', 'time'].map((k) => [
        k,
        results.filter((r) => r.capHits.includes(k)).length,
      ]),
    ),
    aborted: results.filter((r) => r.end === 'aborted').length,
    traceMismatches: results.filter((r) => r.traceMismatch).length,
    // A's trials that inspected at least once: the omitted claims were one call away (§3.1)
    aInspectRate: rate(
      results.filter((r) => r.spec.condition === 'A'),
      (r) => r.metrics.inspected,
    ),
    codexSpawnRate: share(
      results.filter((r) => r.spec.driver === 'codex-cli'),
      (r) => r.spawned,
    ),
    // per condition and model (and task, which is fixed per condition)
    cells: [...cells].map(([cell, rs]) => ({ cell, ...group(rs) })),
    // per condition, across models, for the rates intake decides on (capped above 5%, none above 10%)
    conditions: [...new Set(results.map((r) => r.spec.condition))].map((condition) => ({
      condition,
      ...group(results.filter((r) => r.spec.condition === condition)),
    })),
  }
}

import type { BenchAgent, BenchRun } from '@/lib/bench'

// the bench's numbers as the site writes them; no node imports, so client components can use these too

export const int = (n: number) => Math.round(n).toLocaleString('en-US')
export const sec = (ms: number) => `${(ms / 1000).toFixed(1)}s`
export const usd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumSignificantDigits: 2 })
export const pct = (r: number) => `${Math.round(r * 100)}%`
export const passed = (a: BenchAgent, runs: number) => Math.round(a.successRate * runs)
// "2.6×", and whether that's in the Afford agent's favour (lower is better for every metric here)
export const times = (browser: number, afford: number) =>
  afford <= browser
    ? { x: `${(browser / afford).toFixed(1)}×`, better: true }
    : { x: `${(afford / browser).toFixed(1)}×`, better: false }

// a run's four headline figures: the Afford agent against the browser agent, big number first
export const headline = ({ browser: b, afford: a }: BenchRun) => {
  const tok = (1 - a.tokens / b.tokens) * 100
  const time = times(b.ms, a.ms)
  const cost =
    a.costPerSuccessUsd !== undefined && b.costPerSuccessUsd !== undefined
      ? times(b.costPerSuccessUsd, a.costPerSuccessUsd)
      : null
  return [
    {
      big: `${Math.abs(Math.round(tok))}%`,
      label: tok >= 0 ? 'fewer tokens' : 'more tokens',
      a: int(a.tokens),
      b: int(b.tokens),
    },
    { big: time.x, label: time.better ? 'faster' : 'slower', a: sec(a.ms), b: sec(b.ms) },
    cost
      ? {
          big: cost.x,
          label: cost.better ? 'cheaper per success' : 'costlier per success',
          a: usd(a.costPerSuccessUsd!),
          b: usd(b.costPerSuccessUsd!),
        }
      : { big: `${a.turns}`, label: `steps, not ${b.turns}`, a: `${a.turns}`, b: `${b.turns}` },
    {
      big: pct(a.successRate),
      label: 'tasks completed',
      a: pct(a.successRate),
      b: pct(b.successRate),
    },
  ]
}

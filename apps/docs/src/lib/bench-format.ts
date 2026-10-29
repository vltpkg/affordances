import type { AgentKey, BenchAgent, BenchRun } from '@/lib/bench'

// the bench's numbers as the site writes them; no node imports, so client components can use these too

export const int = (n: number) => Math.round(n).toLocaleString('en-US')
export const sec = (ms: number) => `${(ms / 1000).toFixed(1)}s`
export const usd = (n: number) =>
  n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    // two figures always: $0.10, not $0.1
    minimumSignificantDigits: 2,
    maximumSignificantDigits: 2,
  })
export const pct = (r: number) => `${Math.round(r * 100)}%`
export const passed = (a: BenchAgent, runs: number) => Math.round(a.successRate * runs)
// "2.6×", and whether that's in the Affordances agent's favour (lower is better for every metric here)
export const times = (browser: number, afford: number) =>
  afford <= browser
    ? { x: `${(browser / afford).toFixed(1)}×`, better: true }
    : { x: `${(afford / browser).toFixed(1)}×`, better: false }

// the agents a run has, in the order every chart, table and legend lists them
export const agentsOf = (run: Pick<BenchRun, 'vision'>): AgentKey[] =>
  run.vision ? ['browser', 'vision', 'afford'] : ['browser', 'afford']
export const agentName: Record<AgentKey, string> = {
  browser: 'browser agent',
  vision: 'screenshot agent',
  afford: 'Affordances agent',
}

type Figure = {
  big: string
  label: string
  // which baseline the big figure is measured against, and how the other one compares
  against?: string
  also?: string
  values: Record<AgentKey, string | undefined>
}

// a run's four headline figures, big number first. each is measured against the stronger baseline for that
// metric, the conservative number, and names it; the weaker baseline's ratio follows
export const headline = (run: BenchRun): Figure[] => {
  const a = run.afford
  const bases = agentsOf(run).filter((k): k is 'browser' | 'vision' => k !== 'afford')
  const ratio = (
    get: (x: BenchAgent) => number | undefined,
    fmt: (n: number) => string,
    better: string,
    worse: string,
  ): Figure | null => {
    const mine = get(a)
    const ranked = bases
      .flatMap((k) => {
        const v = get(run[k]!)
        return v === undefined ? [] : [{ k, v }]
      })
      .toSorted((x, y) => x.v - y.v)
    if (mine === undefined || !ranked.length) return null
    const [first, second] = ranked.map((r) => ({ ...r, t: times(r.v, mine) }))
    return {
      big: first!.t.x,
      label: first!.t.better ? better : worse,
      against: `than the ${agentName[first!.k]}`,
      also: second
        ? `${second.t.x} ${second.t.better ? better.split(' ')[0] : worse.split(' ')[0]} than the ${agentName[second.k]}`
        : undefined,
      values: {
        browser: fmt(get(run.browser)!),
        vision: run.vision && get(run.vision) !== undefined ? fmt(get(run.vision)!) : undefined,
        afford: fmt(mine),
      },
    }
  }
  const tokens = ratio((x) => x.tokens, int, 'fewer tokens', 'more tokens')!
  const time = ratio((x) => x.ms, sec, 'faster', 'slower')!
  const cost = ratio((x) => x.costPerSuccessUsd, usd, 'cheaper per success', 'costlier per success')
  const steps: Figure = {
    big: `${a.turns}`,
    label: 'turns',
    against: `against ${bases.map((k) => `${run[k]!.turns} for the ${agentName[k]}`).join(' and ')}`,
    values: {
      browser: `${run.browser.turns}`,
      vision: run.vision && `${run.vision.turns}`,
      afford: `${a.turns}`,
    },
  }
  return [
    tokens,
    time,
    cost ?? steps,
    {
      big: pct(a.successRate),
      label: 'tasks completed',
      values: {
        browser: pct(run.browser.successRate),
        vision: run.vision && pct(run.vision.successRate),
        afford: pct(a.successRate),
      },
    },
  ]
}

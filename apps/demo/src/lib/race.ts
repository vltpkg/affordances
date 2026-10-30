import type { AgentKind, DemoEvent } from '@affordances/bench/events'

export type { AgentKind, DemoEvent }
export type Run = Extract<DemoEvent, { type: 'run' }>
export type Setup = Extract<DemoEvent, { type: 'agent' }>
export type Turn = Extract<DemoEvent, { type: 'turn' }>
export type ToolResult = Extract<DemoEvent, { type: 'tool' }>
export type Frame = Extract<DemoEvent, { type: 'frame' }>
export type Done = Extract<DemoEvent, { type: 'done' }>
export type Call = Turn['calls'][number]

// lane order, left to right: the baselines first, the agent they're measured against last
const ORDER: AgentKind[] = ['browser', 'vision', 'webmcp', 'afford']

// the agents a recording races, from what each was given up front; a kind this app doesn't know yet (a
// newer recorder) still gets a lane, after the ones it does
export const agentsOf = (events: DemoEvent[]): AgentKind[] => {
  const present = [...new Set(events.flatMap((e) => (e.type === 'agent' ? [e.agent] : [])))]
  return [...ORDER.filter((a) => present.includes(a)), ...present.filter((a) => !ORDER.includes(a))]
}

// a per-kind lookup that answers for kinds it doesn't list, so an unknown agent renders instead of crashing
export const byKind = (map: Record<AgentKind, string>, fallback: (kind: string) => string) =>
  new Proxy(map, { get: (m, kind: string) => m[kind as AgentKind] ?? fallback(kind) })

export const NAMES = byKind(
  {
    browser: 'Browser agent',
    afford: 'Affordances agent',
    webmcp: 'Browser agent + WebMCP',
    vision: 'Screenshot agent',
  },
  (kind) => `${kind} agent`,
)
export const SHORT = byKind(
  { browser: 'Browser', afford: 'Affordances', webmcp: '+ WebMCP', vision: 'Screenshot' },
  (kind) => kind,
)
// each lane's colour; orange always means affordances, so webmcp's lane is blue and the page tools it
// discovers (affordances actions, registered by the page) are orange inside it; the two plain browser
// agents are neutrals
export const LANE = byKind(
  {
    browser: '[--lane:var(--browser)]',
    afford: '[--lane:var(--afford)]',
    webmcp: '[--lane:var(--webmcp)]',
    vision: '[--lane:var(--vision)]',
  },
  () => '[--lane:var(--muted-foreground)]',
)

// two stories: the affordances agent against browser agents (snapshot, screenshot, or both), or the same browser agent with and without
// a browser that offers the tools a page registers (WebMCP)
export type Story = 'race' | 'discovery'
export const storyOf = (agents: AgentKind[]): Story =>
  agents.includes('webmcp') ? 'discovery' : 'race'
export const STORIES: Record<Story, { label: string; about: string }> = {
  race: {
    label: 'Affordances vs browser agents',
    about:
      'Same model, task and fresh store, on one clock. Browser agents read the page and click; the Affordances agent reads its graph and calls actions.',
  },
  discovery: {
    label: 'Discovery: a browser agent finds it via WebMCP',
    about:
      'The same browser agent twice, on one clock. Only the right one’s browser supports WebMCP, so a page can hand it tools. Neither is told Affordances exists.',
  },
}

// mirrors EFFORT in apps/bench/src/loop.ts, for the methodology panel
export const EFFORT = 'medium'

// mirrors PRICES in apps/bench/src/loop.ts (which can't be bundled: it builds an api client on import), so
// cost can count up turn by turn; the done event's own costUsd is the final word
// ponytail: hand-copied list prices, read them from the bench if it ever exports them without the client
const PRICES: Record<
  string,
  [input: number, output: number, cacheRead: number, cacheWrite: number]
> = {
  'claude-opus-5-5': [4, 20, 0.2, 5],
  'claude-sonnet-5-5': [2, 10, 0.2, 2.5],
  'claude-haiku-5-5': [0.1, 0.5, 0.01, 0.125],
}

const at = (e: DemoEvent) => ('at' in e ? e.at : 0)
const tokensOf = ({ usage: u }: Turn) => u.input + u.cacheRead + u.cacheWrite + u.output

// what a lane is doing at the playhead: inferred from the past alone, so a live stream reads the same way
export type Activity =
  | { kind: 'thinking'; since: number }
  | { kind: 'tool'; call: Call; since: number }
  | { kind: 'done'; done: Done }

// a turn and the results of the tools it called; `offered` is the toolbox the model had on that turn
export type Step = Omit<Turn, 'tools'> & {
  offered?: string[]
  results: ToolResult[]
  tokens: number
}

export type Lane = {
  agent: AgentKind
  setup?: Setup
  // the tools every turn has; anything else was registered by the page the agent is on
  builtins: Set<string>
  // the toolbox right now: what the model has (or had) on its latest turn, and what that turn lost
  toolbox: string[]
  lost: string[]
  // page tools across the run so far: offered at some point, and actually called
  offered: string[]
  called: string[]
  steps: Step[]
  read?: ToolResult
  frame?: Frame
  activity: Activity
  turns: number
  toolCalls: number
  errors: number
  tokens: number
  costUsd: number | null
  elapsed: number
}

export const lane = (events: DemoEvent[], agent: AgentKind, t: number, model: string): Lane => {
  const price = PRICES[model]
  const out: Lane = {
    agent,
    builtins: new Set(),
    toolbox: [],
    lost: [],
    offered: [],
    called: [],
    steps: [],
    activity: { kind: 'thinking', since: 0 },
    turns: 0,
    toolCalls: 0,
    errors: 0,
    tokens: 0,
    costUsd: price ? 0 : null,
    elapsed: t,
  }
  let done: Done | undefined
  let last = 0
  let before: string[] = []
  for (const e of events) {
    if (!('agent' in e) || e.agent !== agent) continue
    if (e.type === 'agent') {
      out.setup = e
      out.builtins = new Set(e.tools.map((tool) => tool.name))
      out.toolbox = [...out.builtins]
      continue
    }
    // the model has its toolbox from the moment its request goes out, before the answer comes back (live,
    // that's when the turn arrives)
    if (e.type === 'turn' && e.tools && e.at - e.ms <= t) {
      before = out.toolbox
      out.toolbox = e.tools
      out.lost = before.filter((name) => !e.tools!.includes(name))
      for (const name of e.tools)
        if (!out.builtins.has(name) && !out.offered.includes(name)) out.offered.push(name)
    }
    if (e.at > t) continue
    if (e.type === 'turn') {
      const tokens = tokensOf(e)
      const { tools: offered, ...turn } = e
      out.steps.push({ ...turn, offered, results: [], tokens })
      out.turns++
      out.tokens += tokens
      if (price && out.costUsd !== null) {
        const u = e.usage
        out.costUsd +=
          (u.input * price[0] +
            u.output * price[1] +
            u.cacheRead * price[2] +
            u.cacheWrite * price[3]) /
          1e6
      }
      last = e.at
    } else if (e.type === 'tool') {
      out.steps.at(-1)?.results.push(e)
      out.toolCalls++
      if (e.error) out.errors++
      if (out.offered.includes(e.name) && !out.called.includes(e.name)) out.called.push(e.name)
      out.read = e
      last = e.at
    } else if (e.type === 'frame') out.frame = e
    else if (e.type === 'done') done = e
  }
  if (done) {
    out.activity = { kind: 'done', done }
    out.elapsed = done.at
    if (done.costUsd || out.costUsd === null) out.costUsd = done.costUsd
    return out
  }
  // tools run one after another, so the next unanswered call started when the previous one returned
  const step = out.steps.at(-1)
  const call = step?.calls[step.results.length]
  out.activity = call ? { kind: 'tool', call, since: last } : { kind: 'thinking', since: last }
  return out
}

// the whole race as spans, for the scrubber: model time, tool time (page tools apart), and the finish
export type Span = { from: number; to: number; kind: 'think' | 'tool' | 'page' | 'error' }
export const spans = (events: DemoEvent[], agent: AgentKind) => {
  const out: Span[] = []
  let builtins = new Set<string>()
  // a page tool is one a turn offered beyond the built-ins; the screenshot agent's computer actions
  // (left_click, type) aren't tools of their own, so they don't count
  const page = new Set<string>()
  let done: Done | undefined
  for (const e of events) {
    if (!('agent' in e) || e.agent !== agent) continue
    if (e.type === 'agent') builtins = new Set(e.tools.map((tool) => tool.name))
    if (e.type === 'turn') {
      out.push({ from: e.at - e.ms, to: e.at, kind: 'think' })
      for (const name of e.tools ?? []) if (!builtins.has(name)) page.add(name)
    }
    if (e.type === 'tool')
      out.push({
        from: e.at - e.ms,
        to: e.at,
        kind: e.error ? 'error' : page.has(e.name) ? 'page' : 'tool',
      })
    if (e.type === 'done') done = e
  }
  return { spans: out, done }
}

export const duration = (events: DemoEvent[]) => events.reduce((max, e) => Math.max(max, at(e)), 0)

// every tool call the model makes, final or not, adds its whole context again: the meter's scale
export const finalTokens = (events: DemoEvent[], agent: AgentKind) =>
  events.reduce((sum, e) => (e.type === 'turn' && e.agent === agent ? sum + tokensOf(e) : sum), 0)

// the recorder writes frames off the agent's clock, so they can land slightly out of order
export const sorted = (events: DemoEvent[]) => events.toSorted((a, b) => at(a) - at(b))

// ── formatting ──

export const sec = (ms: number) => `${(Math.max(0, ms) / 1000).toFixed(1)}s`
export const int = (n: number) => Math.round(n).toLocaleString('en-US')
// haiku runs cost fractions of a cent, so small amounts keep more digits
export const usd = (n: number) => `$${n.toFixed(n === 0 ? 2 : n < 0.01 ? 4 : n < 0.1 ? 3 : 2)}`
export const kb = (chars: number) =>
  chars < 1000 ? `${chars} chars` : `${(chars / 1000).toFixed(1)}k chars`
export const ratio = (a: number, b: number) => {
  const r = a / b
  return r >= 10 ? `${Math.round(r)}×` : `${r.toFixed(1)}×`
}

// claude-opus-5-5 → Opus 5.5
export const modelName = (model: string) => {
  const [name = model, ...version] = model.replace(/^claude-/, '').split('-')
  return `${name[0]?.toUpperCase()}${name.slice(1)} ${version.join('.')}`.trim()
}

const q = (v: unknown) => JSON.stringify(v ?? '')

// one line per call, the way a person would say it
export const callLabel = (name: string, input: unknown) => {
  const i = (input ?? {}) as Record<string, unknown>
  switch (name) {
    case 'goto':
      return { verb: 'goto', arg: String(i.path ?? '') }
    case 'click':
      return { verb: 'click', arg: `${i.role} ${q(i.name)}` }
    case 'fill':
      return { verb: 'fill', arg: `${q(i.label)} ← ${q(i.value)}` }
    case 'press':
      return { verb: 'press', arg: String(i.key ?? '') }
    case 'affordances_open':
      return { verb: 'open', arg: String(i.path ?? '') }
    case 'affordances_call': {
      const args = i.input && Object.keys(i.input).length ? ` ${JSON.stringify(i.input)}` : ''
      return { verb: 'call', arg: `${i.action}${args}${i.confirm ? ' ✓confirm' : ''}` }
    }
    default:
      return { verb: name, arg: JSON.stringify(input) }
  }
}

// playwright's call log carries terminal colour codes
// oxlint-disable-next-line no-control-regex
export const plain = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, '')
export const firstLine = (text: string) => plain(text).split('\n')[0] ?? ''

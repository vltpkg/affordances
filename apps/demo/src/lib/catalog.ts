import { ratio, storyOf, type AgentKind, type Story } from './race.ts'

// the picker's three levels, story → task → model; a recording file is never something a presenter picks

// what the recorder knows (apps/bench/src/tasks.ts), in the order a presenter would show them
export const TASKS = [
  { id: 'add-to-cart', label: 'Add to cart' },
  { id: 'change-quantity', label: 'Change quantity' },
  { id: 'checkout', label: 'Checkout' },
  { id: 'search', label: 'Search' },
  { id: 'order-status', label: 'Order status' },
  { id: 'two-items-checkout', label: 'Two items + checkout' },
  { id: 'edit-cart', label: 'Edit cart' },
]
export const taskLabel = (id: string) => TASKS.find((t) => t.id === id)?.label ?? id

// claude-opus-5-5 → opus: short enough for a url
export const modelKey = (model: string) => model.replace(/^claude-/, '').split('-')[0] ?? model

export type Entry = {
  id: string
  task: { id: string; prompt: string }
  model: string
  startedAt: string
  agents: AgentKind[]
  done: { agent: AgentKind; at: number; success: boolean }[]
}

export type Selection = { story: Story; task: string; model: string }

const newest = <T extends Entry>(list: T[]) =>
  list.toSorted((a, b) => b.startedAt.localeCompare(a.startedAt))[0]

export const tasksIn = (entries: Entry[], story: Story) =>
  TASKS.filter((t) => entries.some((e) => storyOf(e.agents) === story && e.task.id === t.id))

export const modelsIn = (entries: Entry[], story: Story, task: string) =>
  [
    ...new Set(
      entries
        .filter((e) => storyOf(e.agents) === story && e.task.id === task)
        .map((e) => modelKey(e.model)),
    ),
  ].toSorted((a, b) => (a === 'opus' ? -1 : b === 'opus' ? 1 : a.localeCompare(b)))

// whatever the url asked for, the nearest selection that has a recording: the story, then the task (add to
// cart first), then the model (opus first)
export const resolve = (entries: Entry[], want: Partial<Selection>): Selection | null => {
  const stories = (['race', 'discovery'] as const).filter((s) => tasksIn(entries, s).length)
  const story = stories.find((s) => s === want.story) ?? stories[0]
  if (!story) return null
  const tasks = tasksIn(entries, story)
  const task = (tasks.find((t) => t.id === want.task) ?? tasks[0])!.id
  const models = modelsIn(entries, story, task)
  const model = models.find((m) => m === want.model) ?? models[0]!
  return { story, task, model }
}

// the newest recording for a selection: re-recording a task replaces it without touching the url
export const pick = <T extends Entry>(entries: T[], sel: Selection) =>
  newest(
    entries.filter(
      (e) =>
        storyOf(e.agents) === sel.story &&
        e.task.id === sel.task &&
        modelKey(e.model) === sel.model,
    ),
  )

// a recording's result in a word or two, for the agent on the right (affordances, or the browser with
// webmcp) against the best of the baselines it raced: what a task button previews
export const outcome = (entry: Entry): { text: string; tone: 'win' | 'even' | 'loss' } | null => {
  const done = entry.agents.map((a) => entry.done.find((d) => d.agent === a))
  const other = done.at(-1)
  const bases = done.slice(0, -1)
  if (!other || !bases.length || bases.some((d) => !d)) return null
  const finished = bases.filter((d) => d!.success)
  if (!finished.length) return other.success ? { text: 'others failed', tone: 'win' } : null
  if (!other.success) return { text: 'failed', tone: 'loss' }
  const best = Math.min(...finished.map((d) => d!.at))
  // a few hundred ms is model latency noise, not a result
  if (Math.abs(best - other.at) < 500) return { text: 'tie', tone: 'even' }
  return other.at < best
    ? { text: `${ratio(best, other.at)} faster`, tone: 'win' }
    : { text: `${ratio(other.at, best)} slower`, tone: 'loss' }
}

export const search = (sel: Selection) => `?story=${sel.story}&task=${sel.task}&model=${sel.model}`

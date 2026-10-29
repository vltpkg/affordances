'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from 'cn'
import { BookOpenIcon, PauseIcon, PlayIcon, RotateCcwIcon } from 'lucide-react'
import { Button } from '@affordances/ui/components/button'
import { Kbd } from '@affordances/ui/components/kbd'
import { Wordmark } from '@affordances/ui/components/wordmark'
import { Lane } from '@/components/lane'
import { LiveDialog, type LiveState } from '@/components/live'
import { Methodology } from '@/components/methodology'
import { Summary } from '@/components/summary'
import { Track } from '@/components/track'
import {
  modelKey,
  modelsIn,
  outcome,
  pick,
  resolve,
  search,
  tasksIn,
  type Selection,
} from '@/lib/catalog'
import { LIVE_TASKS } from '@/lib/live'
import {
  agentsOf,
  duration,
  finalTokens,
  LANE,
  lane,
  modelName,
  NAMES,
  sec,
  SHORT,
  sorted,
  STORIES,
  storyOf,
  type AgentKind,
  type DemoEvent,
} from '@/lib/race'
import type { Listing } from '@/lib/recordings'

const SPEEDS = [1, 2, 4]
const MODEL_IDS: Record<string, string> = {
  opus: 'claude-opus-5-5',
  sonnet: 'claude-sonnet-5-5',
  haiku: 'claude-haiku-5-5',
}

// a row of choices where exactly one is on: the story, the model, the speed
const Segmented = <T extends string | number>({
  label,
  value,
  options,
  onChange,
  disabled,
  className,
}: {
  label: string
  value: T
  options: { value: T; label: React.ReactNode }[]
  onChange: (value: T) => void
  disabled?: boolean
  className?: string
}) => (
  <fieldset
    disabled={disabled}
    className={cn('flex shrink-0 rounded-lg border p-0.5 disabled:opacity-50', className)}
  >
    <legend className="sr-only">{label}</legend>
    {options.map((o) => (
      <button
        key={o.value}
        type="button"
        aria-pressed={o.value === value}
        onClick={() => onChange(o.value)}
        className={cn(
          'h-8 rounded-md px-3 text-sm whitespace-nowrap transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
          o.value === value
            ? 'bg-foreground font-medium text-background'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        {o.label}
      </button>
    ))}
  </fieldset>
)

export const Demo = ({
  recordings,
  initial,
}: {
  recordings: Listing[]
  initial: Selection | null
}) => {
  const [sel, setSel] = useState(initial)
  const [events, setEvents] = useState<DemoEvent[]>([])
  const [loaded, setLoaded] = useState<string | null>(null)
  const [t, setT] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [dismissed, setDismissed] = useState(false)
  const [method, setMethod] = useState(false)
  const [live, setLive] = useState<LiveState | null>(null)
  const liveAbort = useRef<AbortController | null>(null)

  // a selection plays the newest recording for it; a live run takes over until something is picked
  const recording = !live && sel ? (pick(recordings, sel) ?? null) : null
  const id = recording?.id ?? null
  const end = duration(events)
  const run = events.find((e) => e.type === 'run')
  const model = run?.model ?? ''
  // the recording's own agents; before its events arrive, what was picked
  const present = agentsOf(events)
  const agents: AgentKind[] = present.length
    ? present
    : (live?.agents ?? recording?.agents ?? ['browser', 'afford'])
  const story = storyOf(agents)
  const lanes = agents.map((agent) => lane(events, agent, t, model))
  const scale = Math.max(1, ...agents.map((a) => finalTokens(events, a)))
  const finished = events.some((e) => e.type === 'end')
  const streaming = live?.status === 'starting' || live?.status === 'running'
  const loading = id !== null && loaded !== id
  const ready = t === 0 && !playing && !streaming && events.length > 0

  useEffect(() => {
    if (!id) return
    const abort = new AbortController()
    fetch(`/api/recordings/${encodeURIComponent(id)}`, { signal: abort.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.statusText))))
      .then((data: { events: DemoEvent[] }) => {
        setEvents(sorted(data.events))
        setT(0)
        setPlaying(false)
        setDismissed(false)
        setLoaded(id)
      })
      .catch(() => {})
    return () => abort.abort()
  }, [id])

  // the playhead: recorded time, scaled; stops at the end
  const tRef = useRef(t)
  useEffect(() => {
    tRef.current = t
  })
  useEffect(() => {
    if (!playing || streaming) return
    let last = performance.now()
    let frame = requestAnimationFrame(function tick(now) {
      const next = Math.min(end, tRef.current + (now - last) * speed)
      last = now
      setT(next)
      if (next >= end) setPlaying(false)
      else frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [playing, streaming, speed, end])

  // live: the wall clock since the recorder's `run`, which is when its own clock started
  const liveStart = live?.status === 'running' ? live.startedAt : null
  useEffect(() => {
    if (liveStart === null) return
    let frame = requestAnimationFrame(function tick() {
      setT(performance.now() - liveStart)
      frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [liveStart])

  const seek = (to: number) => {
    setT(Math.max(0, Math.min(end, to)))
    if (to < end) setDismissed(false)
  }
  const toggle = () => {
    if (streaming || !events.length) return
    if (t >= end) {
      seek(0)
      setPlaying(true)
    } else setPlaying(!playing)
  }

  // the url is the selection, so a presenter can bookmark the exact race
  const choose = (want: Partial<Selection>) => {
    const next = resolve(recordings, { ...sel, ...want })
    if (!next) return
    liveAbort.current?.abort()
    setLive(null)
    setSel(next)
    history.replaceState(null, '', search(next))
  }

  const startLive = async (task: string, liveModel: string, pairing: string) => {
    const racers = pairing.split(',') as AgentKind[]
    liveAbort.current?.abort()
    const abort = new AbortController()
    liveAbort.current = abort
    setEvents([])
    setLoaded(null)
    setT(0)
    setPlaying(false)
    setDismissed(false)
    setSel({ story: storyOf(racers), task, model: modelKey(liveModel) })
    const base = { task, model: liveModel, agents: racers }
    setLive({ ...base, status: 'starting' })
    const failed = (error: string) => setLive({ ...base, status: 'error', error })
    try {
      const response = await fetch('/api/live', {
        method: 'POST',
        body: JSON.stringify({ task, model: liveModel, agents: pairing }),
        signal: abort.signal,
      })
      if (!response.ok || !response.body) {
        const { error } = (await response.json().catch(() => ({}))) as { error?: string }
        return failed(error ?? `The live route answered ${response.status}`)
      }
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
      let buffer = ''
      let all: DemoEvent[] = []
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += value
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          const event = JSON.parse(line) as DemoEvent | { type: 'error'; message: string }
          if (event.type === 'error') return failed(event.message)
          all = [...all, event]
          setEvents(all)
          if (event.type === 'run')
            setLive({ ...base, status: 'running', startedAt: performance.now() })
          if (event.type === 'end') {
            setLive({ ...base, status: 'done' })
            setT(event.at)
          }
        }
      }
    } catch (error) {
      if (!abort.signal.aborted) failed((error as Error).message)
    }
  }

  // presenting: space, arrows, home/end, 1 2 4, m
  useEffect(() => {
    // the scrubber is an input too, but the arrows mean the same thing there
    const typing = ({ target: el }: KeyboardEvent) =>
      el instanceof HTMLElement &&
      (el.isContentEditable ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement ||
        (el instanceof HTMLInputElement && el.type !== 'range'))
    const down = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e)) return
      if (document.querySelector('[role=dialog]')) return
      const step = e.shiftKey ? 5000 : 1000
      const keys: Record<string, () => void> = {
        ' ': toggle,
        k: toggle,
        ArrowLeft: () => seek(t - step),
        ArrowRight: () => seek(t + step),
        Home: () => seek(0),
        End: () => seek(end),
        m: () => setMethod(true),
        Escape: () => setDismissed(true),
        1: () => setSpeed(1),
        2: () => setSpeed(2),
        4: () => setSpeed(4),
      }
      const action = keys[e.key]
      if (!action || (streaming && e.key !== 'm')) return
      e.preventDefault()
      action()
    }
    // a focused button would also take the space as a click
    const up = (e: KeyboardEvent) => e.key === ' ' && !typing(e) && e.preventDefault()
    addEventListener('keydown', down)
    addEventListener('keyup', up)
    return () => {
      removeEventListener('keydown', down)
      removeEventListener('keyup', up)
    }
  })

  const prompt =
    run?.task.prompt ??
    recording?.task.prompt ??
    LIVE_TASKS.find((task) => task.id === live?.task)?.prompt
  const doneAt = (l: (typeof lanes)[0]) =>
    l.activity.kind === 'done' ? l.activity.done.at : Number.POSITIVE_INFINITY
  // how long ago the first finisher finished, for every lane still behind it
  const first = Math.min(...lanes.map(doneAt))
  const behind = (me: (typeof lanes)[0]) =>
    first <= t && first < doneAt(me) ? me.elapsed - first : null

  const storyTasks = sel ? tasksIn(recordings, sel.story) : []
  const models = sel ? modelsIn(recordings, sel.story, sel.task) : []

  return (
    <div className="flex min-h-dvh flex-col xl:h-dvh xl:overflow-hidden">
      {/* story: the top-level choice, then the two quiet buttons */}
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b px-6 py-3">
        <p className="flex items-baseline gap-3">
          <Wordmark />
          <span className="font-pixel text-sm text-muted-foreground">race</span>
        </p>
        {sel && (
          <Segmented
            label="Story"
            value={sel.story}
            options={(['race', 'discovery'] as const)
              .filter((s) => tasksIn(recordings, s).length)
              .map((s) => ({ value: s, label: STORIES[s].label }))}
            onChange={(s) => choose({ story: s })}
          />
        )}
        <div className="ml-auto flex items-center gap-1">
          {live && (
            <p
              className={cn(
                'mr-2 flex items-center gap-2 text-sm',
                live.status === 'error' ? 'text-fail' : 'text-muted-foreground',
              )}
            >
              <span
                aria-hidden
                className={cn('size-2 rounded-full bg-fail', streaming && 'animate-breathe')}
              />
              {live.status === 'starting'
                ? 'Live · starting the store'
                : live.status === 'running'
                  ? 'Live'
                  : live.status === 'done'
                    ? 'Live run · not saved'
                    : 'Live run failed'}
            </p>
          )}
          <Button
            variant="outline"
            className="h-9 gap-2 px-3 text-sm"
            onClick={() => setMethod(true)}
            disabled={!events.some((e) => e.type === 'agent')}
          >
            <BookOpenIcon className="size-4" />
            Methodology
          </Button>
          <LiveDialog busy={streaming} onStart={startLive} />
        </div>
      </header>

      {/* task and model: what this story has recordings for; each task previews its result */}
      {sel && (
        <nav
          aria-label="Task and model"
          className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b px-6 py-2.5"
        >
          <span className="font-pixel text-sm text-muted-foreground">Task</span>
          <ul className="flex flex-wrap gap-1.5">
            {storyTasks.map((task) => {
              const entry =
                pick(recordings, { ...sel, task: task.id }) ??
                pick(recordings, resolve(recordings, { story: sel.story, task: task.id })!)
              const result = entry && outcome(entry)
              const on = task.id === sel.task && !live
              const other = entry?.agents.at(-1)
              return (
                <li key={task.id}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => choose({ task: task.id })}
                    className={cn(
                      'flex h-9 items-center gap-2 rounded-lg border px-3 text-sm transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                      on
                        ? 'border-foreground bg-foreground text-background'
                        : 'text-foreground/85 hover:border-foreground/40',
                    )}
                  >
                    <span className="font-medium">{task.label}</span>
                    {result && (
                      <span
                        className={cn(
                          'font-mono text-[12px] tabular-nums',
                          other && LANE[other],
                          on
                            ? 'text-background/70'
                            : result.tone === 'win'
                              ? 'text-(--lane)'
                              : result.tone === 'loss'
                                ? 'text-fail'
                                : 'text-muted-foreground',
                        )}
                      >
                        {result.text}
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
          <span className="ml-auto font-pixel text-sm text-muted-foreground">Model</span>
          {live ? (
            <span className="text-sm">{modelName(live.model)}</span>
          ) : (
            <Segmented
              label="Model"
              value={sel.model}
              options={models.map((m) => ({ value: m, label: modelName(MODEL_IDS[m] ?? m) }))}
              onChange={(m) => choose({ model: m })}
            />
          )}
        </nav>
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-10 gap-y-4 px-6 pt-5 pb-4">
        <div className="min-w-0 flex-1">
          <h1 className="max-w-[60ch] text-[34px] leading-[1.1] font-semibold tracking-[-0.03em] text-balance 2xl:text-[42px]">
            {prompt ? `“${prompt}”` : 'No recordings yet'}
          </h1>
          <p className="mt-2 max-w-[110ch] text-[15px] text-pretty text-muted-foreground">
            {prompt
              ? STORIES[story].about
              : 'Record one: cd apps/bench && vlr record -- --task add-to-cart'}
          </p>
        </div>
        {/* before the start: the one thing to do */}
        {ready && (
          <Button
            onClick={toggle}
            className="h-12 shrink-0 animate-stamp gap-3 rounded-full px-6 text-base"
          >
            <PlayIcon className="size-4" />
            Start the race
            <Kbd className="bg-background/15 text-background">Space</Kbd>
          </Button>
        )}
      </div>

      <main
        aria-busy={loading}
        className={cn(
          'relative grid flex-1 grid-cols-1 gap-px border-t bg-border xl:min-h-0',
          lanes.length > 2 ? 'xl:grid-cols-3' : 'xl:grid-cols-2',
          loading && 'opacity-60',
        )}
      >
        {lanes.map((l) => (
          <Lane
            key={l.agent}
            lane={l}
            t={t}
            scale={scale}
            behind={behind(l)}
            started={t > 0}
            compact={lanes.length > 2}
          />
        ))}
        {live?.status === 'error' && (
          <div className="absolute inset-0 grid place-items-center bg-background/80 p-6">
            <div role="alert" className="max-w-lg rounded-xl border border-fail/40 bg-card p-6">
              <p className="text-lg font-medium text-fail">The live race didn’t run</p>
              <p className="mt-2 text-[15px] text-pretty">{live.error}</p>
            </div>
          </div>
        )}
        {live?.status === 'starting' && (
          <div className="absolute inset-0 grid place-items-center bg-background/70">
            <p className="flex items-center gap-3 text-lg text-muted-foreground">
              <span aria-hidden className="size-2.5 animate-breathe rounded-full bg-foreground" />
              Starting a fresh store on :3102…
            </p>
          </div>
        )}
        {finished && t >= end && !dismissed && !streaming && (
          <Summary
            lanes={lanes}
            onClose={() => setDismissed(true)}
            onReplay={() => {
              seek(0)
              setPlaying(true)
            }}
          />
        )}
      </main>

      <footer className="flex items-center gap-5 border-t px-6 py-3">
        <Button
          variant="secondary"
          className="size-11 rounded-full"
          aria-label={playing ? 'Pause' : t >= end && end > 0 ? 'Replay' : 'Play'}
          onClick={toggle}
          disabled={streaming || !events.length}
        >
          {playing ? (
            <PauseIcon className="size-5" />
          ) : t >= end && end > 0 ? (
            <RotateCcwIcon className="size-5" />
          ) : (
            <PlayIcon className="size-5 translate-x-px" />
          )}
        </Button>
        <p className="w-36 shrink-0 font-mono text-lg tabular-nums">
          {sec(t)}{' '}
          <span className="text-muted-foreground">{streaming ? 'live' : `/ ${sec(end)}`}</span>
        </p>
        <div className="hidden shrink-0 flex-col gap-1.5 text-right font-mono text-[12px] text-muted-foreground sm:flex">
          {agents.map((a) => (
            <span key={a}>{SHORT[a]}</span>
          ))}
        </div>
        {/* live, the axis grows with the clock */}
        <Track
          agents={agents}
          events={events}
          t={t}
          end={streaming ? Math.max(end, t) : end}
          onSeek={seek}
          disabled={streaming}
        />
        <Segmented
          label="Speed"
          value={speed}
          options={SPEEDS.map((s) => ({
            value: s,
            label: <span className="font-mono">{s}×</span>,
          }))}
          onChange={setSpeed}
          disabled={streaming}
        />
        <p className="hidden shrink-0 items-center gap-1.5 text-xs text-muted-foreground 2xl:flex">
          <Kbd>Space</Kbd> play <Kbd>←</Kbd>
          <Kbd>→</Kbd> seek <Kbd>M</Kbd> methodology
        </p>
      </footer>

      {/* the finish, for screen readers: the timers above change too often to announce */}
      <p aria-live="polite" className="sr-only">
        {lanes
          .flatMap((l) =>
            l.activity.kind === 'done'
              ? [
                  `${NAMES[l.agent]} ${l.activity.done.success ? 'done' : 'failed'} in ${sec(l.activity.done.at)}.`,
                ]
              : [],
          )
          .join(' ')}
      </p>

      <Methodology open={method} onOpenChange={setMethod} events={events} recording={recording} />
    </div>
  )
}

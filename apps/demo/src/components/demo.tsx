'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from 'cn'
import { PauseIcon, PlayIcon, RotateCcwIcon, ScanEyeIcon } from 'lucide-react'
import { Button } from '@affordances/ui/components/button'
import { Kbd } from '@affordances/ui/components/kbd'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@affordances/ui/components/select'
import { Wordmark } from '@affordances/ui/components/wordmark'
import { Lane } from '@/components/lane'
import { LiveDialog, type LiveState } from '@/components/live'
import { Summary } from '@/components/summary'
import { Track } from '@/components/track'
import { XRay } from '@/components/x-ray'
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
  type Story,
} from '@/lib/race'
import { LIVE_TASKS } from '@/lib/live'
import type { Listing } from '@/lib/recordings'

const SPEEDS = [1, 2, 4]

// what the header says each lane was told, per story
const FRAMING: Record<Story, string> = {
  race: 'Same task, same model, same store, one clock',
  discovery:
    'The same browser agent twice, on one clock. Only the right one’s browser supports WebMCP. Neither is told Affordances exists.',
}

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })

export const Demo = ({ recordings, initial }: { recordings: Listing[]; initial?: string }) => {
  const [id, setId] = useState(
    recordings.find((r) => r.id === initial)?.id ?? recordings[0]?.id ?? null,
  )
  const [events, setEvents] = useState<DemoEvent[]>([])
  const [loaded, setLoaded] = useState<string | null>(null)
  const [t, setT] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [dismissed, setDismissed] = useState(false)
  const [xray, setXray] = useState(false)
  const [live, setLive] = useState<LiveState | null>(null)
  const liveAbort = useRef<AbortController | null>(null)

  const end = duration(events)
  const run = events.find((e) => e.type === 'run')
  const model = run?.model ?? ''
  const current = recordings.find((r) => r.id === id)
  // the recording's own agents; before its events arrive, what was picked
  const present = agentsOf(events)
  const agents: AgentKind[] = present.length
    ? present
    : (live?.agents ?? current?.agents ?? ['browser', 'afford'])
  const story = storyOf(agents)
  const lanes = agents.map((agent) => lane(events, agent, t, model))
  const scale = Math.max(1, ...agents.map((a) => finalTokens(events, a)))
  const finished = events.some((e) => e.type === 'end')
  const streaming = live?.status === 'starting' || live?.status === 'running'
  const loading = id !== null && loaded !== id

  // a recording: fetched from disk when picked (the picker is the url, so a reload keeps it)
  useEffect(() => {
    if (!id) return
    const abort = new AbortController()
    fetch(`/api/recordings/${encodeURIComponent(id)}`, { signal: abort.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.statusText))))
      .then((recording: { events: DemoEvent[] }) => {
        setEvents(sorted(recording.events))
        setT(0)
        setPlaying(false)
        setDismissed(false)
        setLoaded(id)
      })
      .catch(() => {})
    history.replaceState(null, '', `?r=${encodeURIComponent(id)}`)
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

  const startLive = async (task: string, liveModel: string, pairing: string) => {
    const racers = pairing.split(',') as AgentKind[]
    liveAbort.current?.abort()
    const abort = new AbortController()
    liveAbort.current = abort
    setId(null)
    setEvents([])
    setT(0)
    setPlaying(false)
    setDismissed(false)
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
  const pick = (next: string) => {
    liveAbort.current?.abort()
    setLive(null)
    setId(next)
  }

  // presenting: space, arrows, home/end, 1 2 4, x
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
        x: () => setXray(true),
        Escape: () => setDismissed(true),
        1: () => setSpeed(1),
        2: () => setSpeed(2),
        4: () => setSpeed(4),
      }
      const action = keys[e.key]
      if (!action || (streaming && e.key !== 'x')) return
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
    current?.task.prompt ??
    LIVE_TASKS.find((task) => task.id === live?.task)?.prompt
  const doneAt = (l: (typeof lanes)[0]) =>
    l.activity.kind === 'done' ? l.activity.done.at : Number.POSITIVE_INFINITY
  // how long ago the first finisher finished, for every lane still behind it
  const first = Math.min(...lanes.map(doneAt))
  const behind = (me: (typeof lanes)[0]) =>
    first <= t && first < doneAt(me) ? me.elapsed - first : null

  return (
    <div className="flex min-h-dvh flex-col xl:h-dvh xl:overflow-hidden">
      <header className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4 border-b px-6 py-4">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] text-muted-foreground">
            <Wordmark className="mr-1 text-foreground" />
            {story === 'discovery' && (
              <span className="rounded-full bg-webmcp/15 px-2 py-px text-[13px] text-webmcp">
                Discovery
              </span>
            )}
            <span>
              {FRAMING[story]}
              {model && (
                <>
                  {' · '}
                  <span className="text-foreground">{modelName(model)}</span>
                </>
              )}
            </span>
          </p>
          <h1 className="mt-2 text-3xl font-medium tracking-tight text-balance 2xl:text-4xl">
            {prompt ? `“${prompt}”` : 'No recordings yet'}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {live ? (
            <p
              className={cn(
                'flex h-9 items-center gap-2 rounded-md border px-3 text-sm',
                live.status === 'error' && 'border-fail/50 text-fail',
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
          ) : null}
          {recordings.length > 0 && (
            <Select
              value={id}
              onValueChange={(v) => v && pick(v)}
              items={recordings.map((r) => ({
                value: r.id,
                label: `${r.task.id} · ${modelName(r.model)} · ${time(r.startedAt)}`,
              }))}
            >
              <SelectTrigger aria-label="Recording" className="h-9 min-w-72 px-3 text-sm">
                <SelectValue placeholder="Pick a recording" />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false} align="end" className="min-w-[30rem]">
                {(['race', 'discovery'] as const).map((group) => {
                  const list = recordings.filter((r) => storyOf(r.agents) === group)
                  if (!list.length) return null
                  return (
                    <SelectGroup key={group}>
                      <SelectLabel className="px-2.5 pt-2 text-[13px]">
                        {STORIES[group]}
                      </SelectLabel>
                      {list.map((r) => (
                        <SelectItem
                          key={r.id}
                          value={r.id}
                          className="min-h-9 gap-3 px-2.5 text-sm"
                        >
                          <span>{r.task.id}</span>
                          <span className="text-muted-foreground">
                            {modelName(r.model)} · {time(r.startedAt)}
                          </span>
                          {/* each agent's finish, in lane order and colour */}
                          <span className="ml-auto flex gap-3 pr-5 font-mono text-[13px] tabular-nums">
                            {r.agents.map((agent) => {
                              const d = r.done.find((x) => x.agent === agent)
                              return (
                                <span
                                  key={agent}
                                  className={cn(
                                    'flex w-16 items-center justify-end gap-1.5',
                                    LANE[agent],
                                    d?.success ? 'text-muted-foreground' : 'text-fail',
                                  )}
                                >
                                  <span aria-hidden className="size-1.5 rounded-full bg-(--lane)" />
                                  <span className="sr-only">{NAMES[agent]}</span>
                                  {d ? `${sec(d.at)}${d.success ? '' : '✗'}` : '—'}
                                </span>
                              )
                            })}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )
                })}
              </SelectContent>
            </Select>
          )}
          <Button
            variant="outline"
            className="h-9 gap-2 px-3 text-sm"
            onClick={() => setXray(true)}
            disabled={!events.some((e) => e.type === 'agent')}
          >
            <ScanEyeIcon className="size-4" />
            X-ray
          </Button>
          <LiveDialog busy={streaming} onStart={startLive} />
        </div>
      </header>

      <main
        aria-busy={loading}
        className={cn(
          'relative grid flex-1 grid-cols-1 gap-px bg-border xl:min-h-0',
          lanes.length > 2 ? 'xl:grid-cols-3' : 'xl:grid-cols-2',
          loading && 'opacity-60',
        )}
      >
        {lanes.map((l) => (
          <Lane key={l.agent} lane={l} t={t} scale={scale} behind={behind(l)} started={t > 0} />
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
          // ponytail: the summary compares the first two lanes; a three-way race shows lanes only
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
        <div className="hidden shrink-0 flex-col gap-1.5 text-right text-xs text-muted-foreground sm:flex">
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
        <fieldset className="flex shrink-0 rounded-lg border p-0.5" disabled={streaming}>
          <legend className="sr-only">Speed</legend>
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={speed === s}
              onClick={() => setSpeed(s)}
              className={cn(
                'h-8 min-w-11 rounded-md px-2 font-mono text-sm transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50',
                speed === s
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {s}×
            </button>
          ))}
        </fieldset>
        <p className="hidden shrink-0 items-center gap-1.5 text-xs text-muted-foreground 2xl:flex">
          <Kbd>Space</Kbd> play <Kbd>←</Kbd>
          <Kbd>→</Kbd> seek <Kbd>X</Kbd> x-ray
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

      <XRay open={xray} onOpenChange={setXray} events={events} />
    </div>
  )
}

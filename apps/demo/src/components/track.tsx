'use client'

import { cn } from 'cn'
import { AGENTS, NAMES, sec, spans, type DemoEvent } from '@/lib/race'

// the scrubber: each agent's race as spans on one time axis, model time faint, tool time solid, errors red.
// what's ahead of the playhead stays a faint outline, so scrubbing has landmarks without spoiling the finish
export const Track = ({
  events,
  t,
  end,
  onSeek,
  disabled,
}: {
  events: DemoEvent[]
  t: number
  end: number
  onSeek: (t: number) => void
  disabled?: boolean
}) => {
  const span = Math.max(end, 1)
  const x = (ms: number) => `${(Math.min(ms, span) / span) * 100}%`
  return (
    <div className="relative h-12 min-w-0 flex-1 rounded-md has-focus-visible:ring-2 has-focus-visible:ring-ring/50">
      <div aria-hidden className="absolute inset-0 flex flex-col justify-center gap-1.5">
        {AGENTS.map((agent) => {
          const { spans: list, done } = spans(events, agent)
          return (
            <div
              key={agent}
              className={cn(
                'relative h-4 rounded-[3px] bg-muted/70',
                agent === 'afford' ? '[--lane:var(--afford)]' : '[--lane:var(--browser)]',
              )}
            >
              {list.map((s, i) => {
                const past = s.from <= t
                // a span still running at the playhead hasn't failed yet
                const kind = s.kind === 'error' && s.to > t ? 'tool' : s.kind
                const width = `calc(${x(Math.min(s.to, past ? t : s.to))} - ${x(s.from)})`
                return (
                  <span
                    key={i}
                    className={cn(
                      'absolute rounded-[2px]',
                      kind === 'think' ? 'inset-y-1.5' : 'inset-y-0',
                      !past
                        ? 'bg-foreground/10'
                        : kind === 'error'
                          ? 'bg-fail'
                          : kind === 'tool'
                            ? 'bg-(--lane)'
                            : 'bg-(--lane)/40',
                    )}
                    // a tool that took 4ms still gets a visible tick
                    style={{ left: x(s.from), width: `max(2px, ${width})` }}
                  />
                )
              })}
              {done && done.at <= t && (
                <span
                  className={cn(
                    'absolute -inset-y-0.5 w-[3px] animate-stamp rounded-full',
                    done.success ? 'bg-(--lane)' : 'bg-fail',
                  )}
                  style={{ left: x(done.at) }}
                />
              )}
            </div>
          )
        })}
      </div>
      <span
        aria-hidden
        className="pointer-events-none absolute -inset-y-0.5 w-0.5 -translate-x-1/2 rounded-full bg-foreground"
        style={{ left: x(t) }}
      />
      <input
        type="range"
        min={0}
        max={span}
        step={100}
        value={Math.min(t, span)}
        disabled={disabled}
        onChange={(e) => onSeek(Number(e.target.value))}
        aria-label="Race time"
        aria-valuetext={`${sec(t)} of ${sec(end)}. ${AGENTS.map((a) => NAMES[a]).join(' above, ')} below.`}
        className="absolute inset-0 size-full cursor-pointer opacity-0 outline-none disabled:cursor-default"
      />
    </div>
  )
}

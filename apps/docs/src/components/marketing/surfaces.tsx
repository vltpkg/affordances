'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import { cn } from 'cn'
import { CodeCard, type CodeTab } from '@afford/ui/components/code-card'

type Surface = {
  id: string
  name: string
  who: string
  hint: string
  agent: boolean
  lines: number[]
  note: string
  tab: CodeTab
}

// the line in the source the connectors leave from: `export const addToCart = defineAction({`
const ORIGIN_LINE = 2

// one definition on the left, its five surfaces on the right. selecting a surface lights the lines of the
// definition it reads, sends one pulse down its connector, and shows what it produces
export const Surfaces = ({ source, surfaces }: { source: CodeTab; surfaces: Surface[] }) => {
  const [sel, setSel] = useState(2)
  const [paths, setPaths] = useState<string[]>([])
  const root = useRef<HTMLDivElement>(null)
  const svg = useRef<SVGSVGElement>(null)
  const tabs = useRef<(HTMLButtonElement | null)[]>([])
  const current = surfaces[sel]!

  // the connectors are measured, not assumed, so they follow the code card's real line positions
  useLayoutEffect(() => {
    const measure = () => {
      const box = svg.current?.getBoundingClientRect()
      const lines = root.current?.querySelectorAll('.how-src .line')
      const line = lines?.[ORIGIN_LINE]?.getBoundingClientRect()
      if (!box?.width || !line) return setPaths([])
      const y0 = line.top + line.height / 2 - box.top
      const w = box.width
      setPaths(
        tabs.current.map((tab) => {
          const r = tab!.getBoundingClientRect()
          const y = r.top + r.height / 2 - box.top
          return `M0 ${y0} C ${w * 0.55} ${y0}, ${w * 0.45} ${y}, ${w} ${y}`
        }),
      )
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (root.current) ro.observe(root.current)
    document.fonts?.ready.then(measure, () => {})
    return () => ro.disconnect()
  }, [])

  const onKey = (e: React.KeyboardEvent) => {
    const last = surfaces.length - 1
    const next = { ArrowDown: sel + 1, ArrowUp: sel - 1, Home: 0, End: last }[e.key]
    if (next === undefined) return
    e.preventDefault()
    const i = (next + surfaces.length) % surfaces.length
    setSel(i)
    tabs.current[i]?.focus()
  }

  const css = surfaces
    .filter((s) => s.lines.length)
    .map(
      (s) =>
        `${s.lines.map((n) => `.how[data-s='${s.id}'] .how-src .line:nth-of-type(${n + 1})`).join(',')}{opacity:1;background:var(${s.agent ? '--agent-soft' : '--hl'});box-shadow:inset 2px 0 0 var(${s.agent ? '--agent' : '--fg'})}`,
    )
    .join('')

  return (
    <div
      ref={root}
      data-s={current.id}
      className="how grid grid-cols-[minmax(0,1fr)_56px_minmax(0,1fr)] items-start max-[899px]:grid-cols-1 max-[899px]:gap-6"
    >
      <style>{css}</style>
      <div className="how-src min-w-0">
        <CodeCard tabs={[source]} />
      </div>

      <svg
        ref={svg}
        aria-hidden
        className="h-full w-full self-stretch overflow-visible max-[899px]:hidden"
      >
        {paths.map((d, i) => (
          <path
            key={i}
            d={d}
            fill="none"
            pathLength={1}
            className={cn(
              'transition-[stroke] duration-200',
              i === sel
                ? surfaces[i]!.agent
                  ? 'stroke-(--agent)'
                  : 'stroke-(--fg)'
                : 'stroke-(--line2)',
            )}
            strokeWidth={i === sel ? 1.5 : 1}
          />
        ))}
        {paths[sel] && (
          <path
            key={`pulse-${sel}`}
            d={paths[sel]}
            fill="none"
            pathLength={1}
            strokeWidth={3}
            strokeLinecap="round"
            className={cn('how-pulse', current.agent ? 'stroke-(--agent)' : 'stroke-(--fg)')}
          />
        )}
        {paths[0] && (
          <circle
            cx={0}
            cy={Number(paths[0].split(' ')[1])}
            r={3.5}
            className={current.agent ? 'fill-(--agent)' : 'fill-(--fg)'}
          />
        )}
      </svg>

      <div className="flex min-w-0 flex-col gap-4">
        <div
          role="tablist"
          aria-label="Surfaces"
          aria-orientation="vertical"
          className="flex flex-col overflow-hidden rounded-xl border border-(--line2)"
        >
          {surfaces.map((s, i) => (
            <button
              key={s.id}
              ref={(el) => {
                tabs.current[i] = el
              }}
              type="button"
              role="tab"
              id={`how-tab-${s.id}`}
              aria-selected={i === sel}
              aria-controls="how-panel"
              tabIndex={i === sel ? 0 : -1}
              onClick={() => setSel(i)}
              onKeyDown={onKey}
              className={cn(
                'relative flex h-12 items-center gap-3 border-t border-(--line) px-4 text-left transition-colors duration-150 first:border-t-0 focus-visible:-outline-offset-2',
                i === sel ? 'bg-(--bg2)' : 'hover:bg-(--bg3)/60',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'size-[7px] flex-none rounded-full transition-colors duration-150',
                  i !== sel ? 'bg-(--line2)' : s.agent ? 'bg-(--agent)' : 'bg-(--fg)',
                )}
              />
              <span
                className={cn(
                  'text-[15px] font-medium tracking-[-0.01em]',
                  i === sel ? 'text-(--fg)' : 'text-(--fg2)',
                )}
              >
                {s.name}
              </span>
              <span className="text-[13px] text-(--fg3) max-[420px]:hidden">{s.who}</span>
              <span
                className={cn(
                  'ml-auto truncate font-mono text-xs',
                  i === sel && s.agent ? 'text-(--agent)' : 'text-(--fg3)',
                )}
              >
                {s.hint}
              </span>
            </button>
          ))}
        </div>

        <div role="tabpanel" id="how-panel" aria-labelledby={`how-tab-${current.id}`}>
          <CodeCard tabs={[current.tab]} className="min-h-[200px] text-[12.5px]" />
          <p className="mt-3 px-1 text-sm leading-normal text-pretty text-(--fg2)">
            {/* `backticks` in a note are code, as they are in its markdown */}
            {current.note.split('`').map((part, i) =>
              i % 2 ? (
                <code key={i} className="font-mono text-[0.9em] text-(--fg)">
                  {part}
                </code>
              ) : (
                part
              ),
            )}
          </p>
        </div>
      </div>
    </div>
  )
}

'use client'

import { useRef, useState } from 'react'
import { cn } from 'cn'
import { CodeCard, type CodeTab } from '@affordances/ui/components/code-card'
import { fan, Origin, Pulse, useConnectors } from './connectors'

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
  const root = useRef<HTMLDivElement>(null)
  const svg = useRef<SVGSVGElement>(null)
  const tabs = useRef<(HTMLButtonElement | null)[]>([])
  const current = surfaces[sel]!

  const paths = useConnectors(root, () =>
    fan(svg.current, root.current?.querySelectorAll('.src .line')[ORIGIN_LINE], tabs.current),
  )

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
        `${s.lines.map((n) => `.how[data-s='${s.id}'] .src .line:nth-of-type(${n + 1})`).join(',')}{opacity:1;background:var(${s.agent ? '--agent-soft' : '--hl'});box-shadow:inset 2px 0 0 var(${s.agent ? '--agent' : '--fg'})}`,
    )
    .join('')

  return (
    <div
      ref={root}
      data-s={current.id}
      className="how grid grid-cols-[minmax(0,1fr)_56px_minmax(0,1fr)] items-start max-[899px]:grid-cols-1 max-[899px]:gap-6"
    >
      <style>{css}</style>
      {/* desktop: the definition and, under it, what the selected surface does with it. on a phone both
          columns dissolve into the grid, and order puts the note between the list and the output */}
      <div className="flex min-w-0 flex-col max-[899px]:contents min-[900px]:self-stretch">
        <div className="src flex min-w-0 flex-1 flex-col max-[899px]:order-1">
          <CodeCard tabs={[source]} />
        </div>
        <p
          id="how-note"
          className="mt-3 min-h-[2lh] px-1 text-sm leading-normal text-pretty text-(--fg2) max-[899px]:order-3 max-[899px]:mt-0"
        >
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
          <Pulse
            key={`pulse-${sel}`}
            d={paths[sel]}
            className={current.agent ? 'stroke-(--agent)' : 'stroke-(--fg)'}
          />
        )}
        <Origin paths={paths} className={current.agent ? 'fill-(--agent)' : 'fill-(--fg)'} />
      </svg>

      <div className="flex min-w-0 flex-col gap-4 max-[899px]:contents">
        <div
          role="tablist"
          aria-label="Surfaces"
          aria-orientation="vertical"
          className="flex flex-col overflow-hidden rounded-xl border border-(--line2) max-[899px]:order-2"
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

        <div
          role="tabpanel"
          id="how-panel"
          aria-labelledby={`how-tab-${current.id}`}
          aria-describedby="how-note"
          className="min-w-0 max-[899px]:order-4"
        >
          <CodeCard tabs={[current.tab]} className="min-h-[200px] text-[12.5px]" />
        </div>
      </div>
    </div>
  )
}

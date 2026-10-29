'use client'

import { useEffect, useEffectEvent, useRef, useState } from 'react'
import Link from 'next/link'
import { cn } from 'cn'
import { fan, Origin, Pulse, useConnectors } from './connectors'
import { Caption, PanelHead, panel, second, Split } from './scrolly'

type Step = {
  turn: number
  // when the model asked for it, and when its result came back
  at: number
  done?: number
  name: string
  arg: string
  ms?: number
  // where the result left the agent, and the tools that page registered over WebMCP
  page?: string
  tools?: string[]
  lit?: boolean
}
type Run = { end: number; turns: number; steps: Step[]; title: string; sub: string }

// one recorded run, apps/demo/recordings/2026-10-29T2351-add-to-cart-claude-opus-5-5-webmcp.json: both
// agents on one clock, in ms since it started. `lit` marks the calls the story turns on
const TEE = '/products/heavyweight-tee'
const WEBMCP: Run = {
  end: 9894,
  turns: 4,
  title: 'Four turns.',
  sub: 'One call to addToCart, a tool the page offered. 9.9s.',
  steps: [
    {
      turn: 1,
      at: 1940,
      done: 2712,
      name: 'goto',
      arg: '/',
      ms: 772,
      page: '/',
      tools: ['search'],
    },
    {
      turn: 2,
      at: 3941,
      done: 4552,
      name: 'goto',
      arg: TEE,
      ms: 611,
      page: TEE,
      tools: ['addToCart'],
    },
    {
      turn: 3,
      at: 6740,
      done: 6762,
      name: 'addToCart',
      arg: '{ sku: "TEE-BLK-M", quantity: 1 }',
      ms: 22,
      lit: true,
    },
    {
      turn: 4,
      at: 9887,
      name: 'answer',
      arg: 'I added 1 Heavyweight Tee in size M (SKU TEE-BLK-M, $48.00) to your cart, which now holds 1 item.',
    },
  ],
}
const BROWSER: Run = {
  end: 13240,
  turns: 6,
  title: 'Six turns.',
  sub: 'Two clicks to add it, then a trip to the cart to check. 13.2s.',
  steps: [
    { turn: 1, at: 2029, done: 2714, name: 'goto', arg: '/', ms: 685, page: '/' },
    { turn: 2, at: 4447, done: 5045, name: 'goto', arg: TEE, ms: 598, page: TEE },
    { turn: 3, at: 6741, done: 6773, name: 'click', arg: 'radio "M"', ms: 32, lit: true },
    {
      turn: 4,
      at: 9171,
      done: 9216,
      name: 'click',
      arg: 'button "Add to cart"',
      ms: 45,
      lit: true,
    },
    { turn: 5, at: 10971, done: 11651, name: 'goto', arg: '/cart', ms: 680, page: '/cart' },
    {
      turn: 6,
      at: 13236,
      name: 'answer',
      arg: 'I added one Heavyweight Tee in size M (TEE-BLK-M, $48.00) to your cart, and it’s the only item there.',
    },
  ],
}
const END = 13244
// the replay runs twice as fast as the recording
const SPEED = 2

const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`)
const dur = (ms: number) => (ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`)

// a long path breaks after its slashes, and only there
const Path = ({ page }: { page: string }) =>
  page.split(/(?<=\/)/).map((part, i) => (
    <span key={i} className="whitespace-nowrap">
      {i > 0 && <wbr />}
      {part}
    </span>
  ))

// one agent at time t: the page it's on, the tools that page gave it, and every call so far
const Agent = ({ run, t, webmcp }: { run: Run; t: number; webmcp?: boolean }) => {
  const root = useRef<HTMLDivElement>(null)
  const svg = useRef<SVGSVGElement>(null)
  const origin = useRef<HTMLDivElement>(null)
  const rows = useRef<(HTMLLIElement | null)[]>([])
  const paths = useConnectors(root, () => fan(svg.current, origin.current, rows.current))

  let page = 'about:blank'
  let tools: string[] = []
  for (const s of run.steps)
    if (s.page && s.done! <= t) {
      page = s.page
      tools = s.tools ?? []
    }
  const longest = run.steps.reduce((a, s) => (s.page && s.page.length > a.length ? s.page : a), '')
  const offered = [...new Set(run.steps.flatMap((s) => s.tools ?? []))]
  const done = t >= run.end
  const clock = `${(Math.min(t, run.end) / 1000).toFixed(1)}s`

  return (
    <div className={cn(panel, !webmcp && second)}>
      <PanelHead
        title={webmcp ? 'Agent · WebMCP' : 'Agent · plain browser'}
        count={done ? `${clock} · ${run.turns} turns` : clock}
        agent={webmcp}
      />

      <div
        ref={root}
        className="grid grid-cols-[auto_minmax(16px,1fr)_auto] items-center max-[520px]:grid-cols-[minmax(0,1fr)_20px_minmax(0,1fr)]"
      >
        <div className="rounded-[10px] border border-(--line) bg-(--bg2) px-4 py-3 font-mono text-xs leading-5 max-[520px]:px-3 max-[520px]:text-[11.5px]">
          <div className="mb-1 text-[11.5px] text-(--fg3)">page</div>
          <div ref={origin} className="text-(--fg)">
            <Path page={page} />
          </div>
          {/* the longest path holds the card's width, so it doesn't shift as the agent moves */}
          <div className="invisible h-0">
            <Path page={longest} />
          </div>
        </div>

        {/* no height of its own, so its default 150px can't set the row's */}
        <svg ref={svg} className="h-0 min-h-full w-full self-stretch overflow-visible">
          {paths.map((d, i) => (
            <path
              key={i}
              d={d}
              fill="none"
              className={cn(
                'stroke-(--agent-line) transition-opacity duration-300',
                !tools.includes(offered[i]!) && 'opacity-0',
              )}
            />
          ))}
          {paths.map(
            (d, i) =>
              tools.includes(offered[i]!) && (
                <Pulse key={offered[i]} d={d} className="stroke-(--agent)" />
              ),
          )}
          {tools.length > 0 && <Origin paths={paths} className="fill-(--agent)" />}
        </svg>

        <div className="min-w-0 overflow-hidden rounded-xl border border-(--line2) font-mono text-xs">
          <div className="px-3 pt-2.5 pb-1.5 text-[11.5px] text-(--fg3)">toolbox</div>
          <ul>
            <li className="flex min-h-8 items-center gap-2.5 border-t border-(--line) px-3 py-1.5">
              <span className="size-[7px] flex-none rounded-full bg-(--fg3)" />
              <span className="flex flex-wrap gap-x-2 text-(--fg2)">
                {['goto', 'click', 'fill', 'press'].map((n) => (
                  <span key={n}>{n}</span>
                ))}
              </span>
            </li>
            {offered.map((name, i) => (
              <li
                key={name}
                ref={(el) => {
                  rows.current[i] = el
                }}
                className={cn('tbx flex items-center gap-2.5 px-3', tools.includes(name) && 'on')}
              >
                <span className="size-[7px] flex-none rounded-full bg-(--agent)" />
                <span className="text-(--agent)">{name}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="flex flex-col">
        {run.steps.map((s, i) => {
          const { lit } = s
          return (
            <div
              key={i}
              className={cn(
                'call tight grid grid-cols-[22px_72px_minmax(0,1fr)_auto] items-center gap-2 font-mono text-[12.5px] leading-none',
                t >= s.at && 'on',
                lit &&
                  (webmcp
                    ? 'lit bg-(--agent-soft) shadow-[inset_2px_0_0_var(--agent)]'
                    : 'lit bg-(--hl) shadow-[inset_2px_0_0_var(--fg)]'),
              )}
            >
              <span className="text-(--fg3) tabular-nums">{pad(s.turn)}</span>
              <span className={s.name === 'addToCart' ? 'text-(--agent)' : 'text-(--fg)'}>
                {s.name}
              </span>
              <span className="truncate text-(--fg2)">{s.arg}</span>
              <span className="text-[11.5px] text-(--fg3) tabular-nums">
                {s.done === undefined ? '' : t < s.done ? '…' : dur(s.ms!)}
              </span>
            </div>
          )
        })}
      </div>

      <Caption on={done} sub={run.sub}>
        {run.title}
      </Caption>
    </div>
  )
}

// a browser agent that has never heard of Affordances, with and without WebMCP, on the run's own clock.
// it plays once when it scrolls into view; before hydration and with reduced motion it shows the finish
export const Discovery = () => {
  const root = useRef<HTMLDivElement>(null)
  const frame = useRef(0)
  const [t, setT] = useState(END)
  const [motion, setMotion] = useState(false)

  const play = () => {
    cancelAnimationFrame(frame.current)
    const start = performance.now()
    const tick = (now: number) => {
      const v = (now - start) * SPEED
      // a tenth of a second of the recording is the finest the clock shows, so render no finer
      setT(v >= END ? END : Math.floor(v / 100) * 100)
      if (v < END) frame.current = requestAnimationFrame(tick)
    }
    setT(0)
    frame.current = requestAnimationFrame(tick)
  }
  const start = useEffectEvent(play)

  useEffect(() => {
    const el = root.current
    if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    setMotion(true)
    setT(0)
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          io.disconnect()
          start()
        }
      },
      { threshold: 0.3 },
    )
    io.observe(el)
    return () => {
      io.disconnect()
      cancelAnimationFrame(frame.current)
    }
  }, [])

  return (
    <div ref={root}>
      <div aria-hidden>
        <Split>
          <Agent run={WEBMCP} t={t} webmcp />
          <Agent run={BROWSER} t={t} />
        </Split>
      </div>
      <div className="sr-only">
        <p>
          With WebMCP: it went to the home page, which offered a search tool, then to the
          Heavyweight Tee’s page. That page offered addToCart instead, and the agent called it with
          sku TEE-BLK-M and quantity 1. Done in 9.9 seconds, 4 turns.
        </p>
        <p>
          Without WebMCP: it went to the home page, then the product page, clicked size M, clicked
          Add to cart, then went to the cart to check. Done in 13.2 seconds, 6 turns.
        </p>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-1 text-sm text-(--fg2)">
        <p className="text-pretty">
          One recorded run on Claude Opus 5.5: the same task, both agents on one clock
          {motion && `, replayed at ${SPEED}× speed`}.
        </p>
        <div className="flex items-center gap-4">
          <Link
            href="/docs/guides/react"
            className="text-(--fg) underline decoration-(--line2) underline-offset-4 transition-colors duration-150 hover:decoration-(--fg)"
          >
            React and WebMCP guide
          </Link>
          {motion && (
            <button
              type="button"
              onClick={play}
              className="press h-8 rounded-md border border-(--line2) px-2.5 font-mono text-xs font-medium text-(--fg2) duration-150 hover:bg-(--bg3) hover:text-(--fg)"
            >
              Replay
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

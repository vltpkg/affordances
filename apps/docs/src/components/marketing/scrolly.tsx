'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from 'cn'

const clamp = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`)
const STICKY_TOP = 88

// scroll drives the two panels from 0 to 1. on wide screens a tall track pins them under the header and
// both follow the track; below 900px each panel runs as it enters the viewport. with reduced motion, or a
// viewport too tall to scroll through, they show their finished state (as they do before hydration)
const useScrolly = () => {
  const track = useRef<HTMLDivElement>(null)
  const sticky = useRef<HTMLDivElement>(null)
  const left = useRef<HTMLDivElement>(null)
  const right = useRef<HTMLDivElement>(null)
  const [live, setLive] = useState(false)
  const [p, setP] = useState<[number, number]>([1, 1])

  useEffect(() => {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0
    const measure = () => {
      frame = 0
      const vh = innerHeight
      if (reduced.matches || vh >= 1500) {
        setLive(false)
        setP([1, 1])
        return
      }
      setLive(true)
      const entry = (el: HTMLElement | null) =>
        el ? clamp((vh * 0.85 - el.getBoundingClientRect().top) / (vh * 0.6)) : 0
      if (innerWidth < 900) {
        setP([entry(left.current), entry(right.current)])
        return
      }
      const t = track.current
      const s = sticky.current
      if (!t || !s) return
      const span = t.getBoundingClientRect().height - s.offsetHeight
      const v = span <= 0 ? 1 : clamp((STICKY_TOP - t.getBoundingClientRect().top) / span)
      setP([v, v])
    }
    const schedule = () => {
      frame ||= requestAnimationFrame(measure)
    }
    schedule()
    // the track grows once live, so measure again after that lands
    const again = setTimeout(schedule, 60)
    addEventListener('scroll', schedule, { passive: true })
    addEventListener('resize', schedule)
    reduced.addEventListener('change', schedule)
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(again)
      removeEventListener('scroll', schedule)
      removeEventListener('resize', schedule)
      reduced.removeEventListener('change', schedule)
    }
  }, [])

  return { live, p, track, sticky, left, right }
}

const FileIcon = () => (
  <svg
    className="size-3.5 flex-none text-(--fg3)"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    aria-hidden
  >
    <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" />
    <path d="M14 3v5h5" />
  </svg>
)

const Row = ({ d, n, s, cls }: { d: string; n: string; s: string; cls: string }) => (
  <div className={cn('frow', cls)}>
    <FileIcon />
    <span className="fd">{d}</span>
    <span className="fn">{n}</span>
    <span className="fs">{s}</span>
  </div>
)

const Dot = ({ agent }: { agent?: boolean }) => (
  <span
    className={cn('size-[7px] flex-none rounded-full', agent ? 'bg-(--agent)' : 'bg-(--fg3)')}
  />
)

const PanelHead = ({ title, count, agent }: { title: string; count: string; agent?: boolean }) => (
  <div className="flex items-center justify-between gap-2.5 border-b border-(--line) pb-4 font-mono text-xs text-(--fg3)">
    <span className={cn('flex items-center gap-2', agent ? 'text-(--agent)' : 'text-(--fg)')}>
      <Dot agent={agent} />
      {title}
    </span>
    <span className={cn('tabular-nums', agent ? 'text-(--agent)' : 'text-(--fg2)')}>{count}</span>
  </div>
)

const Caption = ({
  on,
  children,
  sub,
  className,
}: {
  on: boolean
  children: React.ReactNode
  sub: string
  className?: string
}) => (
  <div
    className={cn(
      'cap mt-auto text-[28px] leading-[1.1] font-semibold tracking-[-0.03em]',
      on && 'on',
      className,
    )}
  >
    {children}
    <span className="mt-1.5 block text-sm font-normal tracking-normal text-(--fg2)">{sub}</span>
  </div>
)

const Meter = ({
  label,
  task,
  over,
  segs,
  spill,
  legend,
}: {
  label: string
  task: string
  over?: boolean
  segs: { w: string; c: string }[]
  spill?: string
  legend: [string, string][]
}) => (
  <div>
    <div className="mb-6 flex items-baseline justify-between gap-2.5 font-mono text-xs text-(--fg3)">
      <span className={cn(over && 'font-medium text-(--fg)')}>{label}</span>
      <span>{task}</span>
    </div>
    <div className="relative h-3.5 rounded-sm border border-(--line) bg-(--bg3)">
      <span className="sr-only">{label}</span>
      <div className="absolute inset-0 flex overflow-visible rounded-sm">
        {segs.map((s, i) => (
          <div
            key={i}
            className="seg-m h-full flex-none border-r border-(--bg)"
            style={{ width: `${s.w}%`, background: s.c }}
          />
        ))}
      </div>
      {spill !== undefined && (
        <div className="spill absolute inset-y-0 left-[80%]" style={{ width: `${spill}%` }} />
      )}
      <div className="absolute -top-[5px] -bottom-[5px] left-[80%] w-0 border-l border-dashed border-(--fg2)" />
      <div className="absolute -top-5 left-[80%] -translate-x-1/2 font-mono text-[10px] leading-none whitespace-nowrap text-(--fg3)">
        limit
      </div>
    </div>
    <div className="mt-3 flex flex-wrap gap-x-3.5 gap-y-1.5 font-mono text-[11px] leading-none text-(--fg3)">
      {legend.map(([c, t]) => (
        <span key={t} className="inline-flex items-center gap-1.5">
          <i className="inline-block size-2 rounded-[2px]" style={{ background: c }} />
          {t}
        </span>
      ))}
    </div>
  </div>
)

const SEG = ['var(--agent)', 'var(--agent-mid)', 'var(--agent-low)', 'var(--agent-min)']

const Head = ({
  eyebrow,
  title,
  live,
  children,
}: {
  eyebrow: string
  title: string
  live: boolean
  children: React.ReactNode
}) => (
  <div className={live ? 'mb-7' : 'mb-10'}>
    <p className="mb-4 text-sm font-medium text-(--fg3)">{eyebrow}</p>
    <h2
      className={cn(
        'max-w-[820px] font-semibold tracking-[-0.04em] text-balance max-[899px]:text-[34px]',
        live ? 'text-4xl' : 'text-[44px]',
        // after the size, which cn would otherwise let override it
        'leading-[1.06]',
      )}
    >
      {title}
    </h2>
    <p
      className={cn(
        'max-w-[620px] text-pretty text-(--fg2)',
        live ? 'mt-3 text-base' : 'mt-5 text-lg',
        'leading-[1.6]',
      )}
    >
      {children}
    </p>
  </div>
)

const Split = ({ children }: { children: React.ReactNode }) => (
  <div className="grid grid-cols-2 overflow-hidden rounded-[14px] border border-(--line2) bg-(--bg) max-[899px]:grid-cols-1">
    {children}
  </div>
)

const panel =
  'panel relative box-border flex min-h-[560px] min-w-0 flex-col gap-[18px] px-6 pt-[22px] pb-6'
const second = 'border-l border-(--line2) max-[899px]:border-t max-[899px]:border-l-0'

const STEPS = [
  'screenshot()',
  'scroll(0, 640)',
  'screenshot()',
  'click(412, 288)  // size 10?',
  'screenshot()',
  'click(468, 288)  // wrong pill',
  'screenshot()',
  'fetch /openapi.json',
  'screenshot()',
  'click(320, 410)  // add to cart?',
  'screenshot()',
  'wait(1200)',
  'screenshot()',
  'list MCP tools',
  'screenshot()',
  'click(944, 24)  // cart icon?',
  'screenshot()',
  'fetch /products/court-runner-2.md',
  'scroll(0, 900)',
  'screenshot()',
  'click(640, 712)  // checkout',
  'screenshot()',
  'type(email)',
  'screenshot()',
  'screenshot()  // did it work?',
]

// before: one price edit leaves five hand-written agent surfaces wrong, and the screenshot agent burns
// its context window finding a button
export const Before = () => {
  const { live, p, track, sticky, left, right } = useScrolly()
  const [pb, pbA] = p

  const edited = pb > 0.42
  const files = [
    ['app/products/[slug]/', 'page.tsx'],
    ['public/products/', 'page.md'],
    ['public/', 'openapi.json'],
    ['app/api/mcp/', 'route.ts'],
    ['lib/agent/', 'tools.ts'],
    ['lib/agent/', 'webmcp.ts'],
  ]
  let drifted = 0
  let shown = 0
  const rows = files.map(([d, n], i) => {
    const on = pb > 0.04 + i * 0.05
    const dr = i > 0 && pb > 0.5 + (i - 1) * 0.07
    if (on) shown++
    if (dr) drifted++
    const s = !on ? '' : i === 0 ? (edited ? '$140' : '$160') : dr ? 'still $160' : '$160'
    return { d: d!, n: n!, s, cls: cn(on && 'on', dr && 'drift', i === 0 && edited && 'edited') }
  })

  const steps = Math.min(25, Math.floor(clamp(pbA / 0.82) * 25))
  const log = steps === 0 ? [{ t: '› task: add Court Runner 2, size 10, to cart', cur: false }] : []
  for (let k = Math.max(0, steps - 4); k < steps; k++)
    log.push({ t: `#${pad(k + 1)}  ${STEPS[k]}`, cur: k === steps - 1 })
  const v = [steps * 3.2, pbA > 0.4 ? 18 : 0, pbA > 0.56 ? 14 : 0, pbA > 0.7 ? 10 : 0]
  const total = v.reduce((a, b) => a + b, 0)
  const over = total > 100

  return (
    <div className={cn(live && 'live')}>
      <div className="track relative" ref={track}>
        <div ref={sticky} className={cn(live && 'sticky')}>
          <Head
            eyebrow="Before"
            title="Serving agents today means describing every page five more times."
            live={live}
          >
            A markdown twin. An OpenAPI spec. MCP routes. Tool handlers. WebMCP glue. Each one a
            hand-written copy of what the UI already knows.
          </Head>
          <Split>
            <div className={panel} ref={left}>
              <PanelHead title="Developer" count={`${shown} files · 1 route`} />
              <div className="flex flex-col">
                {rows.map((r) => (
                  <Row key={r.d + r.n} {...r} />
                ))}
              </div>
              <div
                className={cn(
                  'snip rounded-[10px] border border-(--line) bg-(--bg2) px-4 py-3.5 font-mono text-[12.5px] leading-[1.7]',
                  pb > 0.34 && 'on',
                  edited && 'done',
                )}
              >
                <div className="mb-1.5 text-[11.5px] text-(--fg3)">page.tsx · line 14</div>
                <div className="old">{'<Price amount={160} />'}</div>
                <div className="new">{'<Price amount={140} />'}</div>
              </div>
              <Caption
                on={pb > 0.86}
                sub={`${drifted} of 5 files still say $160. Nothing fails. Agents just get it wrong.`}
              >
                One edit. Five lies.
              </Caption>
            </div>
            <div className={cn(panel, second)} ref={right}>
              <PanelHead title="Agent · screenshot loop" count={`step ${pad(steps)} / 25`} agent />
              <div className="relative h-[84px]">
                {Array.from({ length: 25 }, (_, i) => (
                  <div
                    key={i}
                    className={cn(
                      'th absolute top-2 box-border flex h-16 w-[18%] flex-col gap-[5px] rounded-md border border-(--line2) bg-(--bg2) p-[7px]',
                      i < steps && 'on',
                      i === steps - 1 && 'cur',
                    )}
                    style={{ left: `${(i * 3.4).toFixed(1)}%` }}
                  >
                    <i className="block h-[5px] w-3/5 rounded-[2px] bg-(--line2)" />
                    <i className="block h-3.5 rounded-[2px] bg-(--bg3)" />
                    <i className="block h-[5px] w-2/5 rounded-[2px] bg-(--line2)" />
                  </div>
                ))}
              </div>
              <div className="min-h-[84px] font-mono text-xs leading-[1.75] text-(--fg3)">
                {log.map((l) => (
                  <div key={l.t} className={cn(l.cur && 'text-(--fg)')}>
                    {l.t}
                  </div>
                ))}
              </div>
              <Meter
                label={over ? 'Context window exceeded' : 'Context window'}
                task="task: add to cart, size 10"
                over={over}
                segs={v.map((x, j) => ({ w: (x * 0.8).toFixed(2), c: SEG[j]! }))}
                spill={Math.max(0, total * 0.8 - 80).toFixed(2)}
                legend={[
                  [SEG[0]!, 'screenshots'],
                  [SEG[1]!, 'openapi.json'],
                  [SEG[2]!, 'MCP tool list'],
                  [SEG[3]!, 'page.md'],
                ]}
              />
              <Caption on={pbA > 0.88} sub="To add one pair of shoes to a cart.">
                Twenty-five screenshots.
              </Caption>
            </div>
          </Split>
        </div>
      </div>
    </div>
  )
}

// after: three files per route, every surface derived from them, and an agent that finishes in five calls
export const After = () => {
  const { live, p, track, sticky, left, right } = useScrolly()
  const [pa, paA] = p

  const edit = pa > 0.5
  let count = 0
  const files: { d: string; n: string; keep?: boolean; g?: number; at?: number }[] = [
    { d: 'app/products/[slug]/', n: 'page.tsx', keep: true },
    { d: 'public/products/', n: 'page.md', g: 0 },
    { d: 'public/', n: 'openapi.json', g: 1 },
    { d: 'app/api/mcp/', n: 'route.ts', g: 2 },
    { d: 'lib/agent/', n: 'tools.ts', g: 3 },
    { d: 'lib/agent/', n: 'webmcp.ts', g: 4 },
    { d: 'app/products/[slug]/', n: 'state.ts', at: 0.36 },
    { d: 'app/products/[slug]/', n: 'actions.ts', at: 0.42 },
  ]
  const rows = files.map((f) => {
    if (f.keep) {
      count++
      return { d: f.d, n: f.n, s: 'renders', cls: 'on' }
    }
    if (f.g !== undefined) {
      const gone = pa > 0.1 + f.g * 0.05
      if (!gone) count++
      return { d: f.d, n: f.n, s: 'still $160', cls: gone ? 'on gone' : 'on drift' }
    }
    const on = pa > f.at!
    if (on) count++
    return {
      d: f.d,
      n: f.n,
      s: f.n === 'state.ts' ? (edit ? 'price: $140' : 'price: $160') : '5 surfaces',
      cls: on ? 'on fresh' : '',
    }
  })
  let synced = 0
  const surfaces = ['Server Action', 'WebMCP', 'HTTP graph', 'MCP', 'Markdown'].map((t, j) => {
    const on = pa > 0.55 + j * 0.05
    if (on) synced++
    return { t, v: on ? ' $140' : '', cls: cn(on && 'on', j > 0 && j < 4 && 'ag') }
  })

  // a confirm action is called twice: the first answers confirm_required, the second carries confirm: true
  const C = [
    ['GET', '/products/court-runner-2', '200 graph'],
    ['POST', 'addToCart { size: 10 }', '200 delta'],
    ['GET', '/checkout', '200 graph'],
    ['POST', 'placeOrder', '409 confirm'],
    ['POST', 'placeOrder { confirm: true }', '200 delta'],
  ]
  const calls = C.filter((_, j) => paA > 0.08 + j * 0.13).length
  const segW = [2.6, 1.2, 2.2, 0.8, 1.0]

  return (
    <div className={cn(live && 'live')}>
      <div className="track relative" ref={track}>
        <div ref={sticky} className={cn(live && 'sticky')}>
          <Head
            eyebrow="After, with Afford"
            title="Three files per route. One definition."
            live={live}
          >
            <Code>page.tsx</Code> renders. <Code>state.ts</Code> says what’s on the page.{' '}
            <Code>actions.ts</Code> says what can be done. Every agent surface is derived from
            those, so there’s nothing left to drift.
          </Head>
          <Split>
            <div className={panel} ref={left}>
              <PanelHead title="Developer" count={`${count} files · 1 route`} />
              <div className="flex flex-col">
                {rows.map((r) => (
                  <Row key={r.d + r.n} {...r} />
                ))}
              </div>
              <div>
                <div className="mb-3 flex items-baseline justify-between gap-2.5 font-mono text-xs text-(--fg3)">
                  <span>derived from actions.ts</span>
                  <span>{synced} / 5 in sync</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {surfaces.map((s) => (
                    <span
                      key={s.t}
                      className={cn(
                        'sf inline-flex h-7 items-center gap-1.5 rounded-md border border-(--line) px-2.5 font-mono text-xs text-(--fg3)',
                        s.cls,
                      )}
                    >
                      {s.t}
                      <span className="text-(--fg3)">{s.v}</span>
                    </span>
                  ))}
                </div>
              </div>
              <Caption
                on={pa > 0.86}
                sub="Change the price in state. Humans and agents see $140 together."
              >
                One edit. Every surface.
              </Caption>
            </div>
            <div className={cn(panel, second)} ref={right}>
              <PanelHead title="Agent · Afford graph" count={`call ${calls} / 5`} agent />
              <div className="flex flex-col">
                {C.map(([m, path, r], j) => (
                  <div
                    key={j}
                    className={cn(
                      'call grid grid-cols-[22px_46px_minmax(0,1fr)_auto] items-center gap-2 font-mono text-[12.5px] leading-none text-(--fg2)',
                      j < calls && 'on',
                      j === calls - 1 && 'cur',
                    )}
                  >
                    <span className="no text-(--fg3)">{pad(j + 1)}</span>
                    <span className="text-(--fg)">{m}</span>
                    <span className="truncate text-(--fg)">{path}</span>
                    <span className="re text-[11.5px] text-(--fg3)">{r}</span>
                  </div>
                ))}
              </div>
              <div className="mt-2">
                <Meter
                  label="Context window, same scale"
                  task="task: buy, size 10"
                  segs={segW.map((w, j) => ({
                    w: j < calls ? (w * 0.8).toFixed(2) : '0',
                    c: j === 1 || j === 4 ? SEG[1]! : j === 3 ? SEG[2]! : SEG[0]!,
                  }))}
                  legend={[
                    [SEG[0]!, 'graph'],
                    [SEG[1]!, 'delta'],
                    [SEG[2]!, 'confirm'],
                  ]}
                />
              </div>
              <Caption
                on={paA > 0.8}
                sub="Read the graph, act, read the delta. No pixels involved."
              >
                Five calls.
              </Caption>
            </div>
          </Split>
        </div>
      </div>
    </div>
  )
}

export const Code = ({ children }: { children: React.ReactNode }) => (
  <code className="rounded-[5px] border border-(--line2) bg-(--bg2) px-[5px] py-px font-mono text-[0.86em] text-(--fg)">
    {children}
  </code>
)

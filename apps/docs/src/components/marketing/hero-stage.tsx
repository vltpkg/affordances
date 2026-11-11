'use client'

import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from 'react'
import { cn } from 'cn'
import { Pulse } from '@/components/marketing/connectors'

// one page, two readers, drawn: the page a person sees floats on the left, and what an agent reads
// draws itself beside it, each of its lines tethered to the part of the page it describes. it plays on
// its own: the person clicks, the agent reads the graph and acts, the same page turns to markdown on the
// same tethers, then the next page

// the parts of a page the graph reads, top to bottom. the image is read by neither graph nor markdown
const PARTS = ['count', 'name', 'value', 'pills', 'btn'] as const
type Part = (typeof PARTS)[number]
type Lines = Record<Part | 'img', string[]>

type Scenario = {
  head: string
  meta: string
  name: string
  value: string
  pills: [string, string]
  btn: string
  msg: string
  icon: 'bag' | 'mail' | 'cal'
  key: string
  action: string
  base: number
  // the page as its graph, and as its markdown (@affordances/md)
  json: (n: number) => Lines
  md: (n: number) => Lines
}

const PIXELS = ['// pixels, not read']

const SC = {
  store: {
    head: 'Acme Store',
    meta: 'Over-ear · Black',
    name: 'Cove Headphones',
    value: '$160.00',
    pills: ['Black', 'Sand'],
    btn: 'Add to cart',
    msg: 'Added Cove Headphones (Black) to your cart',
    icon: 'bag',
    key: 'cart.count',
    action: 'addToCart',
    base: 2,
    json: (n) => ({
      count: [`"cart": { "count": ${n} }`],
      img: PIXELS,
      name: ['"name": "Cove Headphones"'],
      value: ['"price": { "amount": 16000 }'],
      pills: ['"colors": {', '  "black": "in_stock", "sand": "sold_out" }'],
      btn: [
        '"action": "addToCart",',
        '"input": { "sku", "color" },',
        '"guard": "color must be in stock",',
        '"available": true',
      ],
    }),
    md: (n) => ({
      count: [`[Cart (${n})](/cart)`],
      img: ['![Cove Headphones](/cove.png)'],
      name: ['# Cove Headphones'],
      value: ['**$160.00** · Over-ear, Black'],
      pills: ['Color: **Black** · ~~Sand~~ sold out'],
      btn: ['[Add to cart](#addToCart)', '`addToCart(sku, color)`', 'color must be in stock'],
    }),
  },
  saas: {
    head: 'Acme / Settings',
    meta: 'Pro plan · 4 of 5 seats used',
    name: 'Acme',
    value: '$20 / seat',
    pills: ['Member', 'Admin'],
    btn: 'Send invite to sam@acme.dev',
    msg: 'Invite sent to sam@acme.dev as Member',
    icon: 'mail',
    key: 'invites.pending',
    action: 'inviteMember',
    base: 1,
    json: (n) => ({
      count: [`"invites": { "pending": ${n} }`],
      img: PIXELS,
      name: ['"team": "Acme"'],
      value: ['"plan": { "name": "Pro", "seat": 2000 }'],
      pills: ['"roles": {', '  "member": "open", "admin": "owners" }'],
      btn: [
        '"action": "inviteMember",',
        '"input": { "email", "role" },',
        '"guard": "owners invite admins",',
        '"available": true',
      ],
    }),
    md: (n) => ({
      count: [`[Invites (${n} pending)](/acme/members)`],
      img: ['![Team seats](/acme/seats.png)'],
      name: ['# Acme'],
      value: ['**Pro** · $20 / seat · 4 of 5 seats'],
      pills: ['Role: **Member** · ~~Admin~~ owners'],
      btn: ['[Send invite](#inviteMember)', '`inviteMember(email, role)`', 'owners invite admins'],
    }),
  },
  booking: {
    head: 'Lune',
    meta: 'Fri 14 Nov · Table 4, by the window',
    name: 'Lune',
    value: 'Fri 20:00',
    pills: ['2 guests', '6 guests'],
    btn: 'Reserve table',
    msg: 'Reserved Lune for 2, Fri 14 Nov at 20:00',
    icon: 'cal',
    key: 'reservations.count',
    action: 'reserveTable',
    base: 0,
    json: (n) => ({
      count: [`"reservations": { "count": ${n} }`],
      img: PIXELS,
      name: ['"name": "Lune"'],
      value: ['"slot": "2026-11-14T20:00"'],
      pills: ['"party": {', '  "2": "available", "6": "waitlist" }'],
      btn: [
        '"action": "reserveTable",',
        '"input": { "time", "party" },',
        '"guard": "party needs a free table",',
        '"available": true',
      ],
    }),
    md: (n) => ({
      count: [`[Reservations (${n})](/reservations)`],
      img: ['![Floor plan](/lune/floor.png)'],
      name: ['# Lune'],
      value: ['**Fri 14 Nov, 20:00** · Table 4'],
      pills: ['**2 guests** · ~~6 guests~~ waitlist'],
      btn: [
        '[Reserve table](#reserveTable)',
        '`reserveTable(time, party)`',
        'party needs a free table',
      ],
    }),
  },
} satisfies Record<string, Scenario>
const ORDER = ['store', 'saas', 'booking'] as const
type Id = (typeof ORDER)[number]

// the board: the page's card on the left, the agent's column on the right
const W = 570
const H = 466
const CARD = { y: 52, w: 250, h: 366 }
const COL = 300
const LINE = 18
// where each part sits on the page (the y its tether leaves from) and where its lines sit in the column
const AT: Record<Part | 'img', { y: number; top: number }> = {
  count: { y: 72, top: 63 },
  img: { y: 152, top: 143 },
  name: { y: 241, top: 232 },
  value: { y: 266, top: 257 },
  pills: { y: 301, top: 292 },
  btn: { y: 354, top: 345 },
}
// a tether from the page to the line that reads it; `back` runs it the other way, for the agent's call
const tether = (p: Part | 'img', back = false) => {
  const a: [number, number] = [CARD.w, AT[p].y]
  const b: [number, number] = [COL - 8, AT[p].top + LINE / 2]
  const [[x1, y1], [x2, y2]] = back ? [b, a] : [a, b]
  const c = back ? -24 : 24
  return `M${x1},${y1} C${x1 + c},${y1} ${x2 - c},${y2} ${x2},${y2}`
}

// the beats: the person arrives and clicks, the agent reads the graph and acts, the page turns to
// markdown, then the column retracts and the next page arrives
type Phase = 'in' | 'human' | 'click' | 'read' | 'act' | 'md' | 'out'
const PHASES: Phase[] = ['in', 'human', 'click', 'read', 'act', 'md', 'out']
const BEATS: Record<Phase, number> = {
  in: 700,
  human: 900,
  click: 1300,
  read: 2800,
  act: 2400,
  md: 2800,
  out: 550,
}

// a line split into what to light (strings and numbers in json; marks, links and code in markdown) and
// the rest
const tokens = (line: string, re: RegExp, lit: string, rest: string) => {
  const parts: { t: string; c: string }[] = []
  let last = 0
  for (let m = re.exec(line); m; m = re.exec(line)) {
    if (m.index > last) parts.push({ t: line.slice(last, m.index), c: rest })
    const key = m[0].startsWith('"') && /^\s*:/.test(line.slice(re.lastIndex))
    parts.push({ t: m[0], c: key ? 'gk' : lit })
    last = re.lastIndex
  }
  if (last < line.length) parts.push({ t: line.slice(last), c: rest })
  return parts
}
const jtok = (line: string) => tokens(line, /"[^"]*"|\b(?:true|false|null)\b|\b\d+\b/g, 'gs', 'gp')
const mtok = (line: string) =>
  tokens(line, /\*\*[^*]+\*\*|~~[^~]+~~|!?\[[^\]]+\]\([^)]+\)|`[^`]+`|^#+ .*/g, 'gs', 'gk')

// a picture that is only a picture
const Placeholder = () => (
  <svg
    width="26"
    height="26"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="text-(--fg3)"
  >
    <rect x="3" y="4" width="18" height="16" rx="2.5" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="M21 16l-4.5-4.5L8 20" />
  </svg>
)

const Seats = () => (
  <div className="flex flex-col items-center gap-2.5">
    <div className="flex gap-2">
      {['AK', 'JL', 'MS', 'RT'].map((s) => (
        <span
          key={s}
          className="flex size-8 items-center justify-center rounded-full border border-(--line2) bg-(--bg3) text-[10px] font-medium text-(--fg2)"
        >
          {s}
        </span>
      ))}
      <span className="flex size-8 items-center justify-center rounded-full border border-dashed border-(--fg) text-[11px] font-medium">
        +
      </span>
    </div>
    <div className="font-mono text-[10px] text-(--fg3)">sam@acme.dev · pending</div>
  </div>
)

// the floor: three round tables with their chairs, the window along the right wall, and table 4, a
// two-top beside it, taken
const Table = ({ x, y, seats, on }: { x: number; y: number; seats: 2 | 4; on?: boolean }) => {
  const chairs =
    seats === 4
      ? [
          [0, -22],
          [0, 22],
          [-22, 0],
          [22, 0],
        ]
      : [
          [0, -22],
          [0, 22],
        ]
  const fill = on ? 'currentColor' : 'var(--bg3)'
  const stroke = on ? 'currentColor' : 'var(--line2)'
  return (
    <g style={{ fill, stroke }}>
      {chairs.map(([dx, dy]) => (
        <circle key={`${dx}${dy}`} cx={x + dx!} cy={y + dy!} r="4" />
      ))}
      <circle cx={x} cy={y} r="13" />
    </g>
  )
}
const Floor = () => (
  <svg viewBox="0 0 300 120" className="h-auto w-full" fill="none" strokeWidth="1.2">
    <path d="M276 14v92" strokeWidth="1" style={{ stroke: 'var(--line2)' }} />
    <path d="M282 14v92" strokeWidth="3" style={{ stroke: 'var(--line2)' }} />
    <Table x={58} y={56} seats={4} />
    <Table x={142} y={56} seats={4} />
    <Table x={226} y={56} seats={2} on />
    <text
      x="226"
      y="104"
      textAnchor="middle"
      style={{ fill: 'currentColor', font: '500 10px var(--font-mono)' }}
    >
      T4 · 2
    </text>
  </svg>
)

const art = { bag: <Placeholder />, mail: <Seats />, cal: <Floor /> }
const icons = {
  bag: <path d="M6 7h12l-1 13H7L6 7zM9 7a3 3 0 0 1 6 0" />,
  mail: (
    <path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 7l9 6 9-6" />
  ),
  cal: (
    <path d="M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM3 10h18M8 3v4M16 3v4" />
  ),
}

const mq = () => matchMedia('(prefers-reduced-motion: reduce)')
const useReduced = () =>
  useSyncExternalStore(
    (cb) => {
      const m = mq()
      m.addEventListener('change', cb)
      return () => m.removeEventListener('change', cb)
    },
    () => mq().matches,
    () => false,
  )

const mono = 'absolute font-mono text-[11px] leading-[18px] whitespace-pre'
// a group's stagger: in on the way down, out on the way back up
const delays = (i: number, j = 0) =>
  ({ '--d': `${200 + i * 220 + j * 60}ms`, '--o': `${(5 - i) * 60}ms` }) as React.CSSProperties

export const HeroStage = () => {
  const [sc, setSc] = useState<Id>('store')
  const [phase, setPhase] = useState<Phase>('in')
  const [seen, setSeen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const reduced = useReduced()

  // plays only while on screen
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => setSeen(e!.isIntersecting), { threshold: 0.4 })
    io.observe(root.current!)
    return () => io.disconnect()
  }, [])
  const step = useEffectEvent(() => {
    if (phase === 'out') setSc(ORDER[(ORDER.indexOf(sc) + 1) % ORDER.length]!)
    setPhase(PHASES[(PHASES.indexOf(phase) + 1) % PHASES.length]!)
  })
  useEffect(() => {
    if (!seen || reduced) return
    const t = setTimeout(step, BEATS[phase])
    return () => clearTimeout(t)
  }, [seen, reduced, phase])

  // under reduced motion the page sits fully read, nothing moves
  const p: Phase = reduced ? 'act' : phase
  const past = (x: Phase) => PHASES.indexOf(p) >= PHASES.indexOf(x)
  const S: Scenario = SC[sc]
  const clicked = past('click')
  const read = past('read') && p !== 'out'
  const acted = past('act')
  // the markdown stays through the exit, so its lines fade with the column
  const md = p === 'md' || p === 'out'
  const n = S.base + (clicked ? 1 : 0) + (acted ? 1 : 0)
  const G = md ? S.md(n) : S.json(n)
  const tok = md ? mtok : jtok

  return (
    <div ref={root} className="hero-art">
      <p className="sr-only">
        A page as a person sees it, with what an agent reads drawn beside it, first as the graph and
        then as markdown: what is on the page, the action it offers with its input and guard, and a
        count that changes when either one acts.
      </p>
      <div className="art-wrap">
        <div className="art relative" style={{ width: W, height: H }} aria-hidden>
          <div className={cn('rd absolute top-0 left-0', !read && 'lit')}>
            <span className="flex items-center gap-1.5">
              <span className="dot bg-(--fg)" />
              Human
            </span>
            <span className="type">text/html</span>
          </div>
          <div className={cn('rd agent absolute top-0', read && 'lit')} style={{ left: COL }}>
            <span className="flex items-center gap-1.5">
              <span className="dot bg-(--agent)" />
              Agent
            </span>
            <span key={md ? 'md' : 'json'} className="type enter">
              {md ? 'text/markdown' : 'application/vnd.affordances+json'}
            </span>
          </div>

          {/* the page: its card stays, and each page's content arrives in it */}
          <div
            className="card absolute left-0"
            style={{ top: CARD.y, width: CARD.w, height: CARD.h }}
          >
            <div key={sc} className="arrive absolute inset-0">
              <div className="absolute inset-x-0 top-0 flex h-10 items-center justify-between border-b border-(--line) px-[18px]">
                <span className="text-[13px] font-semibold">{S.head}</span>
                <span className="flex items-center gap-1.5 text-xs text-(--fg2) tabular-nums">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                  >
                    {icons[S.icon]}
                  </svg>
                  <span key={n} className="enter inline-block">
                    {n}
                  </span>
                </span>
              </div>
              <div className="absolute top-[52px] left-[18px] flex h-24 w-[214px] items-center justify-center overflow-hidden rounded-lg bg-(--img) px-4 text-(--fg)">
                {art[S.icon]}
              </div>
              <div className="absolute top-[160px] left-[18px] text-[11px] text-(--fg3)">
                {S.meta}
              </div>
              <div className="absolute top-[178px] left-[18px] text-[18px] leading-[22px] font-semibold tracking-[-0.01em]">
                {S.name}
              </div>
              <div className="absolute top-[204px] left-[18px] text-[15px] leading-5 text-(--fg2) tabular-nums">
                {S.value}
              </div>
              <div className="absolute top-[232px] left-[18px] flex gap-2">
                <span className="pill sel">{S.pills[0]}</span>
                <span className="pill out">{S.pills[1]}</span>
              </div>
              {/* remounts when the agent acts, so the press plays a second time */}
              <span
                key={acted ? 'agent' : 'human'}
                className={cn(
                  'cta absolute top-[282px] left-[18px] flex h-10 w-[214px] items-center justify-center',
                  (p === 'click' || acted) && 'tap',
                )}
              >
                {S.btn}
              </span>
              <div className="absolute top-[336px] left-[18px] text-[11px] text-(--fg2)">
                {clicked ? S.msg : ''}
              </div>
            </div>
          </div>

          {/* the tethers, drawn as the agent reads; the agent's call runs back down the action's */}
          <svg
            className="absolute inset-0"
            width={W}
            height={H}
            viewBox={`0 0 ${W} ${H}`}
            fill="none"
          >
            <g className={cn('tether dim', read && 'on')} style={delays(1)}>
              <path d={tether('img')} pathLength={1} className="tl" />
              <circle cx={CARD.w} cy={AT.img.y} r="2.5" className="td" />
            </g>
            {PARTS.map((k, i) => (
              <g key={k} className={cn('tether', read && 'on')} style={delays(i)}>
                <path d={tether(k)} pathLength={1} className="tl" />
                <circle cx={CARD.w} cy={AT[k].y} r="2.5" className="td" />
              </g>
            ))}
            {p === 'act' && <Pulse d={tether('btn', true)} className="stroke-(--agent)" />}
          </svg>

          {/* the column: what the agent got back, in the page's order. the markdown takes the same
              lines, so each one swaps in place */}
          <div key={md ? 'md' : 'json'} className="contents">
            <div className={mono} style={{ left: COL, top: AT.img.top }}>
              <div className={cn('ln text-(--fg3)', read && 'on')} style={delays(1, 1)}>
                {G.img[0]}
              </div>
            </div>
            {PARTS.map((k, i) => (
              <div key={k} className={mono} style={{ left: COL, top: AT[k].top }}>
                {G[k].map((text, j) => (
                  <div
                    key={k === 'count' ? `${j}-${n}` : j}
                    className={cn('ln', read && 'on')}
                    style={delays(md ? i / 3 : i, j)}
                  >
                    {tok(text).map((t, m) => (
                      <span key={m} className={t.c}>
                        {t.t}
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
          {/* the agent's call and its answer: a delta with only what changed */}
          {acted && (
            <div
              className={cn(mono, 'enter text-(--agent)', p === 'out' && 'leave')}
              style={{ left: COL, top: AT.btn.top + 4 * LINE + 8 }}
            >
              <span className="text-(--fg3)">POST </span>
              {S.action}
              <span className="text-(--fg3)"> → 200</span>
              {'\n'}
              {S.key}: {n}
            </div>
          )}

          {/* the person's cursor, on its way to the button */}
          <span
            className={cn(
              'cur',
              (p === 'human' || p === 'click') && 'on',
              p === 'click' && 'click',
            )}
          >
            <svg width="22" height="22" viewBox="0 0 24 24">
              <path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z" />
            </svg>
          </span>
        </div>
      </div>
    </div>
  )
}

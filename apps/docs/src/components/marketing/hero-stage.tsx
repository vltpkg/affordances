'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from 'cn'

// three example pages, each as a person sees it and as its graph; the graph's lines are the protocol's
// shape (entities, an actions array of descriptors, nav links), simplified to fit the stage
type Scenario = {
  label: string
  head: string
  path: string
  meta: string
  name: string
  value: string
  optLabel: string
  pills: [string, string]
  pillW: number
  outLabel: string
  btn: string
  msg: string
  icon: 'bag' | 'mail' | 'cal'
  key: string
  action: string
  marker: string
  // what the illustration shows, for screen readers
  art: string
  lines: (n: number) => string[]
}

const actions = (name: string, input: string, guard: string, nav: string) => [
  '  "actions": [',
  `    { "name": "${name}", "expose": "session",`,
  `      "input": ${input},`,
  `      "guard": "${guard}",`,
  '      "available": true }',
  '  ],',
  `  "nav": ${nav}`,
  '}',
]

const SC: Record<'store' | 'saas' | 'booking', Scenario> = {
  store: {
    label: 'Store',
    head: 'Afford Supply',
    path: '/products/court-runner-2',
    meta: 'White / Gum',
    name: 'Court Runner 2',
    value: '$160.00',
    optLabel: 'Size',
    pills: ['10', '11'],
    pillW: 44,
    outLabel: 'Size 11, sold out',
    btn: 'Add to cart',
    msg: 'Added Court Runner 2 (10) to your cart',
    icon: 'bag',
    key: 'cart.count',
    action: 'addToCart',
    marker: '16000',
    art: 'Court Runner 2 sneaker in white with a gum sole, side view',
    lines: (n) => [
      '{',
      '  "entities": {',
      '    "product": {',
      '      "name": "Court Runner 2",',
      '      "price": { "amount": 16000, "currency": "USD" },',
      '      "sizes": { "10": "in_stock", "11": "sold_out" }',
      '    },',
      `    "cart": { "count": ${n} }`,
      '  },',
      ...actions(
        'addToCart',
        '{ "sku": "string", "size": "number" }',
        'size must be in stock',
        '[{ "to": "/cart" }, { "to": "/checkout" }]',
      ),
    ],
  },
  saas: {
    label: 'SaaS',
    head: 'Acme / Settings',
    path: '/acme/settings/team',
    meta: 'Pro plan · 4 of 5 seats used',
    name: 'Acme',
    value: '$20 / seat',
    optLabel: 'Role',
    pills: ['Member', 'Admin'],
    pillW: 88,
    outLabel: 'Admin, owners only',
    btn: 'Send invite to sam@acme.dev',
    msg: 'Invite sent to sam@acme.dev as Member',
    icon: 'mail',
    key: 'invites.pending',
    action: 'inviteMember',
    marker: '2000',
    art: 'Team seats: four members and one pending invite',
    lines: (n) => [
      '{',
      '  "entities": {',
      '    "team": {',
      '      "name": "Acme",',
      '      "plan": { "name": "Pro", "seat": 2000, "seats": 4 },',
      '      "roles": { "member": "allowed", "admin": "owner_only" }',
      '    },',
      `    "invites": { "pending": ${n} }`,
      '  },',
      ...actions(
        'inviteMember',
        '{ "email": "string", "role": "string" }',
        'only owners can invite admins',
        '[{ "to": "/acme/members" }]',
      ),
    ],
  },
  booking: {
    label: 'Booking',
    head: 'Lune',
    path: '/lune/reserve',
    meta: 'Fri 14 Nov · Table 4, by the window',
    name: 'Lune',
    value: 'Fri 20:00',
    optLabel: 'Party',
    pills: ['2 guests', '6 guests'],
    pillW: 96,
    outLabel: '6 guests, waitlist only',
    btn: 'Reserve table',
    msg: 'Reserved Lune for 2, Fri 14 Nov at 20:00',
    icon: 'cal',
    key: 'reservations.count',
    action: 'reserveTable',
    marker: '"2026',
    art: 'Floor plan with table 4 by the window highlighted',
    lines: (n) => [
      '{',
      '  "entities": {',
      '    "restaurant": {',
      '      "name": "Lune",',
      '      "slot": { "date": "2026-11-14", "time": "20:00" },',
      '      "party": { "2": "available", "6": "waitlist" }',
      '    },',
      `    "reservations": { "count": ${n} }`,
      '  },',
      ...actions(
        'reserveTable',
        '{ "time": "string", "party": "number" }',
        'party needs a free table',
        '[{ "to": "/reservations" }]',
      ),
    ],
  },
}
const ORDER = ['store', 'saas', 'booking'] as const
type Id = (typeof ORDER)[number]
// the width of one character of the graph's mono type, for lining the page's parts up with its lines
const CW = 7.5

// a json line, split into keys, strings, literals, and punctuation
const jtok = (line: string) => {
  const parts: { t: string; c: string }[] = []
  const re = /"[^"]*"|\b(?:true|false|null)\b|\b\d+\b/g
  let last = 0
  for (let m = re.exec(line); m; m = re.exec(line)) {
    if (m.index > last) parts.push({ t: line.slice(last, m.index), c: 'gp' })
    const c = m[0].startsWith('"') ? (/^\s*:/.test(line.slice(re.lastIndex)) ? 'gk' : 'gs') : 'gn'
    parts.push({ t: m[0], c })
    last = re.lastIndex
  }
  if (last < line.length) parts.push({ t: line.slice(last), c: 'gp' })
  return parts
}

// the illustrations are described in text for screen readers; the drawings themselves are decoration
const Bag = () => (
  <svg
    width="300"
    height="150"
    viewBox="0 0 240 120"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.2"
    strokeLinejoin="round"
    strokeLinecap="round"
    aria-hidden
  >
    <path d="M14 100h208c6 0 9-3 9-7v-3H12v4c0 4 1 6 2 6z" style={{ fill: 'var(--line2)' }} />
    <path d="M12 90c-1-5 0-9 4-12h208c4 2 7 6 7 12z" style={{ fill: 'var(--bg)' }} />
    <path
      d="M30 94v4M46 94v4M62 94v4M78 94v4M94 94v4M110 94v4M126 94v4M142 94v4M158 94v4M174 94v4M190 94v4M206 94v4"
      strokeWidth=".8"
      style={{ stroke: 'var(--fg3)' }}
    />
    <path
      d="M16 78c-4-12-3-26 6-34 7-6 17-7 25-4 8 2 15 0 21-6l16-13c4-3 10-4 14-1l12 7c7 5 14 14 26 22 13 8 34 12 58 16 17 3 27 7 30 13z"
      style={{ fill: 'var(--bg)' }}
    />
    <path d="M16 78c-4-12-3-26 6-34 6-5 14-6 21-5-4 12-5 26-1 39z" style={{ fill: 'var(--bg3)' }} />
    <path d="M22 44l-4-10c-1-4 2-6 6-4l10 9" />
    <path d="M172 63c26 3 44 7 52 15h-54c-3-5-2-11 2-15z" style={{ fill: 'var(--bg3)' }} />
    <path d="M84 21c-2-6 2-12 9-12l10 2c4 2 5 8 1 12" />
    <path d="M68 34c10 11 26 20 48 24" />
    <path d="M84 21c10 12 24 22 44 27" />
    <path d="M76 30l12-4M84 37l13-5M93 43l14-5M103 49l14-4" strokeWidth="1.4" />
    {[
      [76, 30],
      [84, 37],
      [93, 43],
      [103, 49],
    ].map(([cx, cy]) => (
      <circle key={cx} cx={cx} cy={cy} r="1.4" style={{ fill: 'currentColor' }} />
    ))}
    <path d="M46 68c32-8 76-8 120 2" strokeDasharray="2 3" strokeWidth=".8" />
    <path d="M50 60c22-12 52-14 80-6" strokeWidth=".9" style={{ stroke: 'var(--fg3)' }} />
  </svg>
)

const Seats = () => (
  <div className="flex flex-col items-center gap-3.5" aria-hidden>
    <div className="flex gap-2.5">
      {['AK', 'JL', 'MS', 'RT'].map((s) => (
        <span
          key={s}
          className="flex size-[46px] items-center justify-center rounded-full border border-(--line2) bg-(--bg3) text-[13px] font-medium text-(--fg2)"
        >
          {s}
        </span>
      ))}
      <span className="flex size-[46px] items-center justify-center rounded-full border border-dashed border-(--fg) text-[13px] font-medium">
        +
      </span>
    </div>
    <div className="font-mono text-xs text-(--fg3)">sam@acme.dev · pending</div>
  </div>
)

const Floor = () => (
  <svg
    width="320"
    height="140"
    viewBox="0 0 300 130"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.1"
    aria-hidden
  >
    <rect x="4" y="4" width="292" height="122" rx="6" style={{ stroke: 'var(--line2)' }} />
    <path d="M40 4h220" strokeWidth="3" />
    {[70, 130, 190].map((cx) => (
      <circle
        key={cx}
        cx={cx}
        cy="42"
        r="13"
        style={{ fill: 'var(--bg3)', stroke: 'var(--line2)' }}
      />
    ))}
    <circle cx="245" cy="42" r="13" style={{ fill: 'currentColor' }} />
    <circle cx="245" cy="22" r="3.5" />
    <circle cx="245" cy="62" r="3.5" />
    {[44, 116, 188].map((x) => (
      <rect
        key={x}
        x={x}
        y="84"
        width="46"
        height="24"
        rx="3"
        style={{ fill: 'var(--bg3)', stroke: 'var(--line2)' }}
      />
    ))}
    <path d="M262 126v-22h30" style={{ stroke: 'var(--line2)' }} />
    <text
      x="222"
      y="80"
      stroke="none"
      style={{ fill: 'currentColor', font: '500 10px var(--font-mono)' }}
    >
      T4 · 2
    </text>
  </svg>
)

const icons = {
  bag: <path d="M6 7h12l-1 13H7L6 7zM9 7a3 3 0 0 1 6 0" />,
  mail: (
    <path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 7l9 6 9-6" />
  ),
  cal: (
    <path d="M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM3 10h18M8 3v4M16 3v4" />
  ),
}

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches
const box = (b: { t: number; l: number; w: number; h: number }) => ({
  top: b.t,
  left: b.l,
  width: b.w,
  height: b.h,
})
// a line of text that travels by transform, from where the page sets it (right-aligned when `r`) to the
// graph line that carries its value
type At = { t: number; l: number; f: number; r?: boolean }
const ghost = (human: At, graph: At, agent: boolean) => {
  const at = agent ? graph : human
  const x = !agent && human.r ? -100 : 0
  return {
    fontSize: human.f,
    transform: `translate(${at.l}px, ${at.t}px) translateX(${x}%) scale(${at.f / human.f})`,
  }
}
// the graph's first line, under the url bar; each line is 20px
const line = (i: number) => 60 + i * 20

// one url, two readers: switch the stage between the page a person sees and the graph an agent reads, and
// watch the page's parts move to where the graph says them
export const HeroStage = () => {
  const [sc, setSc] = useState<Id>('store')
  // the tab selects at once; the stage swaps scenario behind a short fade
  const [tab, setTab] = useState<Id>('store')
  const [fading, setFading] = useState(false)
  const [agent, setAgent] = useState(false)
  const [counts, setCounts] = useState<Record<Id, number>>({ store: 2, saas: 1, booking: 0 })
  const [added, setAdded] = useState<Partial<Record<Id, boolean>>>({})
  const [delta, setDelta] = useState('')
  const [flash, setFlash] = useState(false)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  const later = (fn: () => void, ms: number) => timers.current.push(setTimeout(fn, ms))
  const tabs = useRef<HTMLDivElement>(null)

  const S = SC[sc]
  const n = counts[sc]
  const lines = S.lines(n)
  const P = <T,>(human: T, graph: T) => (agent ? graph : human)

  // where each moving part sits: on the page, or over the graph line that carries its value
  const l5 = lines[5]!
  const s1 = l5.indexOf('{ "') + 2
  const mid = l5.indexOf(', "', s1)
  const s2 = mid + 2
  const e2 = l5.lastIndexOf(' }')
  const col = (c: number) => 20 + c * CW
  const pw = S.pillW
  const ms = {
    img: P({ t: 100, l: 20, w: 480, h: 160 }, { t: line(2) - 2, l: 10, w: 500, h: 104 }),
    p1: P(
      { t: 356, l: 20, w: pw, h: 40 },
      { t: line(5) - 1, l: col(s1) - 4, w: (mid - s1) * CW + 8, h: 22 },
    ),
    p2: P(
      { t: 356, l: 28 + pw, w: pw, h: 40 },
      { t: line(5) - 1, l: col(s2) - 4, w: (e2 - s2) * CW + 8, h: 22 },
    ),
    btn: P({ t: 410, l: 20, w: 480, h: 44 }, { t: line(10) - 2, l: 10, w: 500, h: 104 }),
  }
  const gl = 12.5
  const name = ghost(
    { t: 290, l: 20, f: 20 },
    { t: line(3), l: col(lines[3]!.indexOf(': "') + 2), f: gl },
    agent,
  )
  const val = ghost(
    { t: 294, l: 500, f: 17, r: true },
    { t: line(4), l: col(lines[4]!.indexOf(S.marker)), f: gl },
    agent,
  )
  const count = ghost(
    { t: 53, l: 480, f: 13 },
    { t: line(7), l: col(lines[7]!.lastIndexOf(String(n))), f: gl },
    agent,
  )

  const bump = (fromAgent: boolean) => {
    const next = n + 1
    setCounts({ ...counts, [sc]: next })
    setAdded({ ...added, [sc]: true })
    if (fromAgent) {
      setFlash(true)
      setDelta(`← 200 · changed: ${S.key} → ${next}`)
      later(() => setFlash(false), 900)
    }
  }

  // a new scenario starts on the page a person sees
  const pick = (id: Id) => {
    if (id === tab) return
    setTab(id)
    setAgent(false)
    if (reduced()) {
      setSc(id)
      setDelta('')
      return
    }
    setFading(true)
    later(() => {
      setSc(id)
      setFading(false)
      setDelta('')
    }, 150)
  }

  // tabs move with the arrow keys, and focus follows the selection
  const onTabKey = (e: React.KeyboardEvent) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const id = ORDER[(ORDER.indexOf(tab) + step + ORDER.length) % ORDER.length]!
    pick(id)
    tabs.current?.querySelector<HTMLElement>(`[data-tab="${id}"]`)?.focus()
  }

  const seg =
    'seg-b relative z-[1] h-9 w-[104px] rounded-full text-sm font-medium transition-colors duration-150'

  return (
    <div className="flex min-w-0 flex-[0_1_520px] flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <fieldset className="relative m-0 inline-flex min-w-0 rounded-full border border-(--line2) bg-(--bg2) p-[3px]">
          <legend className="sr-only">Read this page as</legend>
          <span
            aria-hidden
            className={cn(
              'seg-ind absolute top-[3px] left-[3px] h-[calc(100%-6px)] w-[calc(50%-3px)] rounded-full bg-(--fg)',
              agent && 'is-agent',
            )}
          />
          <button
            type="button"
            aria-pressed={!agent}
            onClick={() => setAgent(false)}
            className={cn(seg, agent ? 'text-(--fg2) hover:text-(--fg)' : 'text-(--bg)')}
          >
            Human
          </button>
          <button
            type="button"
            aria-pressed={agent}
            onClick={() => setAgent(true)}
            className={cn(seg, agent ? 'text-(--agent-ink)' : 'text-(--fg2) hover:text-(--fg)')}
          >
            Agent
          </button>
        </fieldset>
        <div ref={tabs} role="tablist" aria-label="Example page" className="flex gap-1">
          {ORDER.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`stage-tab-${id}`}
              data-tab={id}
              aria-selected={tab === id}
              aria-controls="stage"
              tabIndex={tab === id ? 0 : -1}
              onClick={() => pick(id)}
              onKeyDown={onTabKey}
              className="h-8 rounded-md px-2.5 text-sm font-medium text-(--fg3) transition-colors duration-150 hover:text-(--fg) aria-selected:bg-(--bg3) aria-selected:text-(--fg)"
            >
              {SC[id].label}
            </button>
          ))}
        </div>
      </div>

      <div
        id="stage"
        role="tabpanel"
        aria-labelledby={`stage-tab-${tab}`}
        className={cn('stage-wrap w-[520px] max-w-full', fading && 'fading')}
      >
        <div
          className={cn(
            'stage relative box-border h-[500px] w-[520px] overflow-hidden rounded-[14px] border border-(--line2) bg-(--bg)',
            agent && 'is-agent',
          )}
        >
          <div className="swap absolute inset-0">
            {/* the url bar: the one thing that stays put, and the one header that changes */}
            <div className="absolute inset-x-0 top-0 flex h-10 items-center justify-between gap-3 border-b border-(--line) bg-(--bg2) px-5 font-mono text-xs">
              <span className="truncate text-(--fg)">
                <span className="url-m text-(--fg3)">GET</span> {S.path}
              </span>
              <span className="whitespace-nowrap text-(--fg3)">
                Accept:{' '}
                <span className="url-a text-(--fg2)">
                  {agent ? 'application/vnd.afford+json' : 'text/html'}
                </span>
              </span>
            </div>

            <div className="hum absolute inset-x-0 top-10 h-11 border-b border-(--line)">
              <div className="absolute top-[13px] left-5 text-sm font-semibold">{S.head}</div>
              <div className="absolute top-[14px] right-11 text-(--fg2)">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  aria-hidden
                >
                  {icons[S.icon]}
                </svg>
              </div>
            </div>

            <div className="m box" style={box(ms.img)}>
              <div className="hf text-(--fg)">
                {S.icon === 'bag' ? <Bag /> : S.icon === 'mail' ? <Seats /> : <Floor />}
                <span className="sr-only">{S.art}</span>
              </div>
            </div>
            <div className="hum absolute top-[270px] left-5 text-xs text-(--fg3)">{S.meta}</div>
            <div className="ghost font-semibold tracking-[-0.01em]" style={name}>
              {S.name}
            </div>
            <div className="ghost tabular-nums" style={val}>
              {S.value}
            </div>
            <div className="ghost text-(--fg2) tabular-nums" style={count}>
              {n}
              <span className="sr-only"> in {S.key.split('.')[0]}</span>
            </div>
            <div className="hum absolute top-[336px] left-5 text-xs text-(--fg3)">{S.optLabel}</div>
            {/* the options are shown, not offered: one is picked, the other unavailable */}
            <span className="m pill sel" style={box(ms.p1)}>
              <span className="hf">{S.pills[0]}</span>
            </span>
            <span className="m pill out" style={box(ms.p2)}>
              <span className="hf" aria-hidden>
                {S.pills[1]}
              </span>
              <span className="sr-only">{S.outLabel}</span>
            </span>
            <button
              type="button"
              className="m cta"
              style={box(ms.btn)}
              onClick={() => bump(false)}
              inert={agent}
            >
              <span className="hf">{S.btn}</span>
            </button>
            <div
              className="hum absolute top-[466px] left-5 text-xs text-(--fg2)"
              aria-live="polite"
            >
              {added[sc] ? S.msg : ''}
            </div>

            <div className="absolute inset-x-5 top-[60px]" aria-hidden={!agent}>
              {lines.map((text, i) => (
                <div
                  key={i}
                  className={cn('gl', i === 7 && flash && 'flash')}
                  style={{ '--d': `${140 + i * 14}ms` } as React.CSSProperties}
                >
                  {jtok(text).map((p, j) => (
                    <span key={j} className={p.c}>
                      {p.t}
                    </span>
                  ))}
                </div>
              ))}
            </div>

            <div
              className="agt absolute inset-x-0 bottom-0 flex h-[72px] items-center justify-between gap-3 border-t border-(--line) px-5 font-mono text-xs"
              inert={!agent}
            >
              <span className="text-(--fg2)" aria-live="polite">
                {delta || 'Call the action. Get back only what changed.'}
              </span>
              <button
                type="button"
                onClick={() => bump(true)}
                className="press h-8 rounded-md border border-(--agent-line) bg-(--agent-soft) px-3 font-mono text-xs font-medium whitespace-nowrap text-(--agent) transition-colors duration-150 hover:bg-(--agent)/20"
              >
                POST {S.action}
              </button>
            </div>
          </div>
        </div>
      </div>

      <p className="text-sm text-pretty text-(--fg3)">
        {agent
          ? 'The same page, as its graph: what’s on it, and what can be done there.'
          : 'Same URL, same session. Switch to Agent to read the page as JSON.'}
      </p>
    </div>
  )
}

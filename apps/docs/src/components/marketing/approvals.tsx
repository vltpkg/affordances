'use client'

import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { cn } from 'cn'

// 0 idle, 1 calling, 2 waiting for a person, 3 approved, 4 declined
type Step = 0 | 1 | 2 | 3 | 4

const SNIPPET = [
  'export const placeOrder = defineAction({',
  "  name: 'placeOrder',",
  "  expose: 'confirm',",
  '  run: (input, ctx) => orders.place(ctx.session.id),',
  '})',
]

// an agent prepares a confirm action; it waits until a person approves. it starts when the section scrolls
// into view (at once with reduced motion), and replays on request
export const Approvals = () => {
  const root = useRef<HTMLDivElement>(null)
  const [step, setStep] = useState<Step>(0)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const run = () => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return setStep(2)
    setStep(1)
    timer.current = setTimeout(() => setStep(2), 1300)
  }

  const start = useEffectEvent(() => run())

  useEffect(() => {
    const el = root.current
    if (!el) return
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
      clearTimeout(timer.current)
    }
  }, [])

  const replay = () => {
    clearTimeout(timer.current)
    setStep(0)
    timer.current = setTimeout(run, 200)
  }

  const lines: { a: string; ac: string; t: string; dim?: boolean }[] = []
  if (step >= 1) {
    lines.push({ a: '→ ', ac: 'text-(--agent)', t: 'call placeOrder' })
    lines.push({ a: '', ac: '', t: '  { "action": "placeOrder", "input": {} }', dim: true })
  }
  if (step >= 2) {
    lines.push({ a: '← ', ac: 'text-(--agent)', t: '409 confirm_required' })
    lines.push({ a: '', ac: '', t: '  { "message": "Place order · $244.00" }', dim: true })
    if (step === 2) lines.push({ a: '… ', ac: 'text-(--fg3)', t: 'waiting for a human', dim: true })
  }
  if (step === 3) {
    lines.push({ a: '→ ', ac: 'text-(--agent)', t: 'call placeOrder { confirm: true }' })
    lines.push({ a: '← ', ac: 'text-(--agent)', t: '200 order placed' })
  }
  if (step === 4)
    lines.push({ a: '× ', ac: 'text-(--fg)', t: 'declined, so the call is never resent' })

  const button =
    'press inline-flex h-11 w-full items-center justify-center rounded-lg border px-[18px] text-sm font-medium duration-150'

  return (
    <div
      ref={root}
      className="mt-12 grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] items-center gap-10 max-[899px]:grid-cols-1"
    >
      <div className="min-w-0 overflow-hidden rounded-xl border border-(--line2) bg-(--bg2)">
        <div className="flex h-11 items-center border-b border-(--line) px-4 font-mono text-[12.5px] leading-none text-(--agent)">
          <span className="flex items-center gap-2">
            <span className="size-[7px] rounded-full bg-(--agent)" />
            agent · MCP session
          </span>
        </div>
        <div className="overflow-x-auto border-b border-(--line) pt-3 pb-3.5">
          {SNIPPET.map((line, i) => (
            <div
              key={i}
              className={cn(
                'flex min-h-[21px] pr-4 font-mono text-[13px] leading-[21px]',
                line.includes('expose') && 'bg-(--agent-soft)',
              )}
            >
              <span
                className={cn(
                  'box-border w-11 flex-none pr-[18px] text-right text-(--fg3) select-none',
                  line.includes('expose') && 'text-(--agent)',
                )}
              >
                {i + 1}
              </span>
              <span className={cn('whitespace-pre text-(--fg)')}>{line}</span>
            </div>
          ))}
        </div>
        <div
          className="min-h-[190px] overflow-x-auto px-[18px] pt-3.5 pb-5 font-mono text-[12.5px] leading-[1.8]"
          aria-live="polite"
        >
          {lines.map((l, i) => (
            <div key={i} className={cn('whitespace-pre', l.dim ? 'text-(--fg3)' : 'text-(--fg2)')}>
              <span className={l.ac}>{l.a}</span>
              {l.t}
            </div>
          ))}
        </div>
      </div>
      {/* the placeholder and the card share one cell, so the empty state is exactly the card's size */}
      <div className="grid min-h-[340px] content-center justify-items-center max-[899px]:min-h-0">
        <div
          className="col-start-1 row-start-1 flex w-full max-w-[360px] items-center justify-center rounded-[14px] border border-dashed border-(--line2) font-mono text-xs text-(--fg3) transition-opacity duration-200"
          style={{ opacity: step >= 2 ? 0 : 1 }}
          aria-hidden
        >
          {step === 1 ? 'Agent is calling placeOrder…' : 'No approval requests'}
        </div>
        <section
          className={cn(
            'ask col-start-1 row-start-1 flex w-full max-w-[360px] flex-col gap-4 rounded-[14px] border border-(--line2) bg-(--bg) p-5',
            step >= 2 && 'on',
          )}
          aria-label="Approval request"
          aria-hidden={step < 2}
          inert={step < 2}
        >
          <div className="flex items-center justify-between text-[13px] text-(--fg3)">
            <span>Afford Supply · approval</span>
            <span>now</span>
          </div>
          <div>
            <p className="m-0 text-[19px] font-semibold tracking-[-0.02em]">
              Agent wants to place an order
            </p>
            <p className="mt-1.5 text-[13px] text-(--fg2)">Requested over MCP, on your session.</p>
          </div>
          <div className="flex flex-col gap-2.5 border-y border-(--line) py-3.5 text-sm text-(--fg2)">
            <div className="flex items-center justify-between">
              <span>Action</span>
              <b className="font-mono text-[13px] font-medium text-(--fg)">placeOrder</b>
            </div>
            <div className="flex items-center justify-between">
              <span>Total</span>
              <b className="font-semibold text-(--fg) tabular-nums">$244.00</b>
            </div>
          </div>
          {step <= 2 && (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setStep(4)}
                className={cn(button, 'border-(--line2) bg-(--bg) text-(--fg) hover:bg-(--bg3)')}
              >
                Decline
              </button>
              <button
                type="button"
                onClick={() => setStep(3)}
                className={cn(button, 'border-(--fg) bg-(--fg) text-(--bg) hover:bg-(--fg)/86')}
              >
                Approve
              </button>
            </div>
          )}
          {step >= 3 && (
            <div className="flex items-center justify-between gap-2.5 font-mono text-[12.5px] leading-snug text-(--fg2)">
              <span>{step === 3 ? 'Approved · order placed' : 'Declined · agent notified'}</span>
              <button
                type="button"
                onClick={replay}
                className="press h-8 rounded-md border border-(--line2) px-2.5 font-mono text-xs font-medium text-(--fg2) duration-150 hover:bg-(--bg3) hover:text-(--fg)"
              >
                Replay
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

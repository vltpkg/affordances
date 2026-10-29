'use client'

import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { cn } from 'cn'

// idle, the agent calling, waiting for a person, approving, approved, declined
type Step = 'idle' | 'calling' | 'waiting' | 'approving' | 'approved' | 'declined'

const SNIPPET = [
  'export const placeOrder = defineAction({',
  "  name: 'placeOrder',",
  "  expose: 'confirm',",
  '  run: (input, ctx) => orders.place(ctx.session.id),',
  '})',
]

const ORDER = 'AS-1042'
const TOTAL = '$244.00'

type Line = { a?: string; t: string; dim?: boolean; agent?: boolean }

// the console for each step: what the agent sent and what came back. lines only ever append within a run,
// so earlier lines keep their keys and only new ones animate in
const consoleFor = (step: Step): Line[] => {
  const lines: Line[] = []
  if (step === 'idle') return lines
  lines.push({ a: '→ ', t: 'call placeOrder' })
  lines.push({ t: '  { "action": "placeOrder", "input": {} }', dim: true })
  if (step === 'calling') return lines
  lines.push({ a: '← ', t: '409 confirm_required' })
  lines.push({ t: `  { "message": "Place order · ${TOTAL}" }`, dim: true })
  if (step === 'waiting') lines.push({ a: '… ', t: 'waiting for a person', dim: true })
  if (step === 'approving' || step === 'approved')
    lines.push({ a: '→ ', t: 'call placeOrder { "confirm": true }' })
  if (step === 'approved') {
    lines.push({ a: '← ', t: '200 ok' })
    lines.push({ t: '  { "changed": { "cart": { "count": 0 } },', dim: true })
    lines.push({ t: '    "redirect": "/account/orders" }', dim: true })
    lines.push({ t: `agent: order ${ORDER} placed`, agent: true })
  }
  if (step === 'declined') {
    lines.push({ a: '× ', t: 'declined by the person' })
    lines.push({ t: 'agent: the person declined; not retrying', agent: true })
  }
  return lines
}

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches

const said: Partial<Record<Step, string>> = {
  waiting: `Approval requested: the agent wants to place an order for ${TOTAL}.`,
  approved: `Order ${ORDER} placed, ${TOTAL}. The agent received the result.`,
  declined: 'Declined, nothing was charged. The agent will not retry.',
}

// an agent prepares a confirm action; it waits until a person approves. it starts when the section scrolls
// into view (at once with reduced motion), and replays on request
export const Approvals = () => {
  const root = useRef<HTMLDivElement>(null)
  const replayButton = useRef<HTMLButtonElement>(null)
  const [step, setStep] = useState<Step>('idle')
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const run = () => {
    if (reduced()) return setStep('waiting')
    setStep('calling')
    timer.current = setTimeout(() => setStep('waiting'), 1300)
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

  // once it resolves, focus goes to the one control left; Replay sits where the buttons were
  useEffect(() => {
    if (step === 'approved' || step === 'declined') replayButton.current?.focus()
  }, [step])

  const approve = () => {
    if (step !== 'waiting') return
    setStep('approving')
    // the resend with confirm: true, and its delta, take a beat; with reduced motion they don't
    timer.current = setTimeout(() => setStep('approved'), reduced() ? 0 : 400)
  }

  const replay = () => {
    clearTimeout(timer.current)
    setStep('idle')
    // the buttons Replay replaced are gone, so focus moves back to the demo rather than the page
    root.current?.focus()
    timer.current = setTimeout(run, 200)
  }

  const lines = consoleFor(step)
  // where this step's new lines start, so only they stagger in
  const fresh = step === 'approved' ? consoleFor('approving').length : lines.length - 1
  const done = step === 'approved' || step === 'declined'

  const button =
    'press inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border px-[18px] text-sm font-medium duration-150 aria-disabled:cursor-default'

  return (
    <div
      ref={root}
      tabIndex={-1}
      className="mt-12 grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] items-center gap-10 outline-none max-[899px]:grid-cols-1"
    >
      <p className="sr-only" aria-live="polite">
        {said[step] ?? ''}
      </p>
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
        {/* tall enough for the longest run, so the console never grows */}
        <div className="h-[244px] overflow-x-auto px-[18px] pt-3.5 pb-5 font-mono text-[12.5px] leading-[1.8]">
          {lines.map((l, i) => (
            <div
              key={`${i}-${l.t}`}
              className={cn(
                'enter whitespace-pre',
                l.agent ? 'text-(--agent)' : l.dim ? 'text-(--fg3)' : 'text-(--fg2)',
              )}
              style={{ animationDelay: `${Math.max(0, i - fresh) * 90}ms` }}
            >
              {l.a && <span className="text-(--agent)">{l.a}</span>}
              {l.t}
            </div>
          ))}
        </div>
      </div>
      {/* the placeholder and the card share one cell, so the empty state is exactly the card's size. its fade
          makes it a stacking context that paints over the card, so it must never take the pointer */}
      <div className="grid min-h-[340px] content-center justify-items-center max-[899px]:min-h-0">
        <div
          className="pointer-events-none col-start-1 row-start-1 flex w-full max-w-[360px] items-center justify-center rounded-[14px] border border-dashed border-(--line2) font-mono text-xs text-(--fg3) transition-opacity duration-200"
          style={{ opacity: step === 'idle' || step === 'calling' ? 1 : 0 }}
          aria-hidden
        >
          {step === 'calling' ? 'Agent is calling placeOrder…' : 'No approval requests'}
        </div>
        <section
          className={cn(
            'ask col-start-1 row-start-1 flex w-full max-w-[360px] flex-col gap-4 rounded-[14px] border border-(--line2) bg-(--bg) p-5',
            step !== 'idle' && step !== 'calling' && 'on',
          )}
          aria-label="Approval request"
          aria-hidden={step === 'idle' || step === 'calling'}
          inert={step === 'idle' || step === 'calling'}
        >
          <div className="flex items-center justify-between text-[13px] text-(--fg3)">
            <span>Acme Store · approval</span>
            <span>now</span>
          </div>

          {/* one shape for every outcome: a title row, a line under it, two rows, a footer */}
          <div key={`title-${done ? step : 'ask'}`} className={cn(done && 'enter')}>
            <p className="m-0 flex items-center gap-2 text-[19px] leading-[26px] font-semibold tracking-[-0.02em]">
              {step === 'approved' && (
                <svg aria-hidden viewBox="0 0 20 20" className="size-5 flex-none">
                  <circle cx="10" cy="10" r="10" className="fill-(--fg)" />
                  <path
                    d="M5.8 10.3l2.8 2.8 5.6-6"
                    pathLength={1}
                    fill="none"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="draw stroke-(--bg)"
                  />
                </svg>
              )}
              {step === 'declined' && (
                <svg aria-hidden viewBox="0 0 20 20" className="size-5 flex-none">
                  <circle
                    cx="10"
                    cy="10"
                    r="9.25"
                    fill="none"
                    strokeWidth={1.5}
                    className="stroke-(--line2)"
                  />
                  <path
                    d="M7 7l6 6M13 7l-6 6"
                    fill="none"
                    strokeWidth={1.75}
                    strokeLinecap="round"
                    className="stroke-(--fg2)"
                  />
                </svg>
              )}
              {step === 'approved'
                ? 'Order placed'
                : step === 'declined'
                  ? 'Declined'
                  : 'Agent wants to place an order'}
            </p>
            <p className="mt-1.5 text-[13px] text-(--fg2)">
              {step === 'approved'
                ? 'The agent got the result and moved on.'
                : step === 'declined'
                  ? 'Nothing was charged. The agent won’t retry.'
                  : 'Requested over MCP, on your session.'}
            </p>
          </div>

          <div className="flex flex-col gap-2.5 border-y border-(--line) py-3.5 text-sm text-(--fg2)">
            <div className="flex items-center justify-between">
              <span>{step === 'approved' ? 'Order' : 'Action'}</span>
              <b className="font-mono text-[13px] font-medium text-(--fg)">
                {step === 'approved' ? ORDER : 'placeOrder'}
              </b>
            </div>
            <div className="flex items-center justify-between">
              <span>Total</span>
              <b
                className={cn(
                  'font-semibold tabular-nums',
                  step === 'declined' ? 'text-(--fg3) line-through' : 'text-(--fg)',
                )}
              >
                {TOTAL}
              </b>
            </div>
          </div>

          {done ? (
            <div
              key={`footer-${step}`}
              className="enter flex h-11 items-center justify-between gap-2.5 font-mono text-[12.5px] leading-snug text-(--fg2)"
            >
              <span>{step === 'approved' ? 'Approved · 200 ok' : 'Declined · no second call'}</span>
              <button
                ref={replayButton}
                type="button"
                onClick={replay}
                className="press h-8 rounded-md border border-(--line2) px-2.5 font-mono text-xs font-medium text-(--fg2) duration-150 hover:bg-(--bg3) hover:text-(--fg)"
              >
                Replay
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => step === 'waiting' && setStep('declined')}
                aria-disabled={step === 'approving'}
                className={cn(
                  button,
                  'border-(--line2) bg-(--bg) text-(--fg) hover:bg-(--bg3) aria-disabled:opacity-50 aria-disabled:hover:bg-(--bg)',
                )}
              >
                Decline
              </button>
              <button
                type="button"
                onClick={approve}
                aria-disabled={step === 'approving'}
                className={cn(button, 'border-(--fg) bg-(--fg) text-(--bg) hover:bg-(--fg)/86')}
              >
                {step === 'approving' && (
                  <svg aria-hidden viewBox="0 0 16 16" className="spin size-3.5 flex-none">
                    <circle
                      cx="8"
                      cy="8"
                      r="6.5"
                      fill="none"
                      strokeWidth={1.75}
                      className="stroke-current opacity-25"
                    />
                    <path
                      d="M8 1.5a6.5 6.5 0 0 1 6.5 6.5"
                      fill="none"
                      strokeWidth={1.75}
                      strokeLinecap="round"
                      className="stroke-current"
                    />
                  </svg>
                )}
                {step === 'approving' ? 'Approving…' : 'Approve'}
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

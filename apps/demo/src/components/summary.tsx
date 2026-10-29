'use client'

import { cn } from 'cn'
import { CheckIcon, RotateCcwIcon, XIcon } from 'lucide-react'
import { Button } from '@affordances/ui/components/button'
import { int, ratio, sec, usd, type Done, type Lane } from '@/lib/race'

// lower is better for every row; the last column says by how much, whichever way it went
type Row = {
  label: string
  value: (d: Done) => number
  format: (n: number) => string
  words: [better: string, worse: string]
}
const ROWS: Row[] = [
  { label: 'Time', value: (d) => d.at, format: sec, words: ['faster', 'slower'] },
  { label: 'Turns', value: (d) => d.turns, format: String, words: ['fewer', 'more'] },
  { label: 'Tool calls', value: (d) => d.toolCalls, format: String, words: ['fewer', 'more'] },
  { label: 'Tokens', value: (d) => d.tokens, format: int, words: ['fewer', 'more'] },
  { label: 'Cost', value: (d) => d.costUsd, format: usd, words: ['cheaper', 'pricier'] },
]

const headline = (b: Done, a: Done) => {
  if (!a.success && !b.success) return 'Neither agent finished the task'
  if (!b.success)
    return `The browser agent didn’t finish. The Affordances agent did, in ${sec(a.at)}.`
  if (!a.success)
    return `The Affordances agent didn’t finish. The browser agent did, in ${sec(b.at)}.`
  // a few hundred ms is model latency noise, not a result
  if (Math.abs(a.at - b.at) < 500) return `A dead heat: both finished in about ${sec(a.at)}`
  if (a.at < b.at) return `The Affordances agent finished ${ratio(b.at, a.at)} faster`
  return `The browser agent finished first, by ${sec(a.at - b.at)}`
}

export const Summary = ({
  browser,
  afford,
  onClose,
  onReplay,
}: {
  browser: Lane
  afford: Lane
  onClose: () => void
  onReplay: () => void
}) => {
  if (browser.activity.kind !== 'done' || afford.activity.kind !== 'done') return null
  const b = browser.activity.done
  const a = afford.activity.done
  return (
    <div className="absolute inset-0 z-10 grid place-items-center bg-background/75 p-6 backdrop-blur-[2px]">
      <section
        aria-labelledby="summary-title"
        className="w-full max-w-3xl animate-stamp rounded-2xl border bg-card p-8 shadow-2xl"
      >
        <h2
          id="summary-title"
          className="text-3xl font-medium tracking-tight text-balance 2xl:text-4xl"
        >
          {headline(b, a)}
        </h2>
        <table className="mt-7 w-full text-left">
          <thead className="text-[14px] text-muted-foreground">
            <tr>
              <th className="pb-2 font-normal">
                <span className="sr-only">Measure</span>
              </th>
              <th className="pb-2 font-normal">
                <span className="mr-2 inline-block size-2 rounded-full bg-browser" />
                Browser
              </th>
              <th className="pb-2 font-normal">
                <span className="mr-2 inline-block size-2 rounded-full bg-afford" />
                Affordances
              </th>
              <th className="pb-2 text-right font-normal">
                <span className="sr-only">Affordances agent, compared</span>
              </th>
            </tr>
          </thead>
          <tbody className="font-mono text-2xl tabular-nums">
            {ROWS.map((row) => {
              const vb = row.value(b)
              const va = row.value(a)
              const better = va < vb
              return (
                <tr key={row.label} className="border-t">
                  <th className="py-2.5 font-sans text-[15px] font-normal text-muted-foreground">
                    {row.label}
                  </th>
                  <td className="py-2.5">{row.format(vb)}</td>
                  <td className="py-2.5 text-afford">{row.format(va)}</td>
                  <td
                    className={cn(
                      'py-2.5 text-right text-xl',
                      better ? 'text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    {ratio(Math.max(va, vb), Math.min(va, vb)) === '1.0×' || !va || !vb
                      ? 'same'
                      : better
                        ? `${ratio(vb, va)} ${row.words[0]}`
                        : `${ratio(va, vb)} ${row.words[1]}`}
                  </td>
                </tr>
              )
            })}
            <tr className="border-t">
              <th className="py-2.5 font-sans text-[15px] font-normal text-muted-foreground">
                Result
              </th>
              {[b, a].map((d) => (
                <td key={d.agent} className={cn('py-2.5 text-xl', !d.success && 'text-fail')}>
                  {d.success ? (
                    <CheckIcon aria-label="Done" className="size-6" />
                  ) : (
                    <span className="flex items-center gap-1.5">
                      <XIcon aria-hidden className="size-6" /> failed
                    </span>
                  )}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
        <div className="mt-7 flex gap-2">
          <Button variant="secondary" className="h-9 gap-2 px-3 text-sm" onClick={onReplay}>
            <RotateCcwIcon className="size-4" />
            Replay
          </Button>
          <Button variant="ghost" className="h-9 px-3 text-sm" onClick={onClose}>
            Back to the race <span className="ml-1 text-muted-foreground">Esc</span>
          </Button>
        </div>
      </section>
    </div>
  )
}

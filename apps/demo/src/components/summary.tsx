'use client'

import { cn } from 'cn'
import { CheckIcon, RotateCcwIcon, XIcon } from 'lucide-react'
import { Button } from '@affordances/ui/components/button'
import { byKind, int, LANE, ratio, sec, SHORT, usd, type Done, type Lane } from '@/lib/race'

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

// in a sentence; the discovery story races the browser agent against itself, so it needs telling apart
const WHO = byKind(
  {
    browser: 'The browser agent',
    afford: 'The Affordances agent',
    webmcp: 'The browser agent with WebMCP',
    vision: 'The screenshot agent',
  },
  (kind) => `The ${kind} agent`,
)
const who = (d: Done, other: Done) =>
  d.agent === 'browser' && other.agent === 'webmcp' ? 'The browser agent without it' : WHO[d.agent]

// b is the baseline (the left lane), a the challenger
const headline = (b: Done, a: Done, several: boolean) => {
  if (!a.success && !b.success) return 'Neither agent finished the task'
  if (!b.success) return `${who(b, a)} didn’t finish. ${who(a, b)} did, in ${sec(a.at)}.`
  if (!a.success) return `${who(a, b)} didn’t finish. ${who(b, a)} did, in ${sec(b.at)}.`
  // a few hundred ms is model latency noise, not a result
  if (Math.abs(a.at - b.at) < 500) return `A dead heat: both finished in about ${sec(a.at)}`
  if (a.at < b.at)
    return `${who(a, b)} finished ${ratio(b.at, a.at)} faster${several ? ` than ${who(b, a).replace(/^The/, 'the')}, the quicker baseline` : ''}`
  return `${who(b, a)} finished first, by ${sec(a.at - b.at)}`
}

export const Summary = ({
  lanes,
  onClose,
  onReplay,
}: {
  lanes: Lane[]
  onClose: () => void
  onReplay: () => void
}) => {
  const all = lanes.flatMap((l) => (l.activity.kind === 'done' ? [l.activity.done] : []))
  if (all.length < 2 || all.length !== lanes.length) return null
  // the agent on the right against the baselines; the comparison column is against the best of them (the
  // fastest that finished), so with several baselines the claim is the conservative one
  const a = all.at(-1)!
  const bases = all.slice(0, -1)
  const b = bases.filter((d) => d.success).toSorted((x, y) => x.at - y.at)[0] ?? bases[0]!
  // the page tools a lane was offered, and which it used: the honest footnote to the discovery story
  const found = lanes.filter((l) => l.offered.length > 0)
  return (
    <div className="absolute inset-0 z-10 grid place-items-center bg-background/75 p-6 backdrop-blur-[2px]">
      <section
        aria-labelledby="summary-title"
        className="w-full max-w-4xl animate-stamp rounded-2xl border bg-card p-8 shadow-2xl"
      >
        <h2
          id="summary-title"
          className="text-3xl font-medium tracking-tight text-balance 2xl:text-4xl"
        >
          {headline(b, a, bases.length > 1)}
        </h2>
        <table className="mt-7 w-full text-left">
          <thead className="text-[14px] text-muted-foreground">
            <tr>
              <th className="pb-2 font-normal">
                <span className="sr-only">Measure</span>
              </th>
              {all.map((d) => (
                <th key={d.agent} className={cn('pb-2 font-normal', LANE[d.agent])}>
                  <span className="mr-2 inline-block size-2 rounded-full bg-(--lane)" />
                  {SHORT[d.agent]}
                </th>
              ))}
              <th className="pb-2 text-right font-normal">
                <span className="sr-only">{SHORT[a.agent]}</span> vs {SHORT[b.agent]}
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
                  {bases.map((d) => (
                    <td key={d.agent} className="py-2.5">
                      {row.format(row.value(d))}
                    </td>
                  ))}
                  <td className={cn('py-2.5 text-(--lane)', LANE[a.agent])}>{row.format(va)}</td>
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
              {all.map((d) => (
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
        {found.map((l) => (
          <p key={l.agent} className="mt-5 text-[15px] text-pretty text-muted-foreground">
            The page offered <span className="font-mono text-afford">{l.offered.join(', ')}</span>.{' '}
            {l.called.length ? (
              <>
                It called <span className="font-mono text-afford">{l.called.join(', ')}</span>{' '}
                instead of clicking through.
              </>
            ) : (
              'It never called one, and read the page instead.'
            )}
          </p>
        ))}
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

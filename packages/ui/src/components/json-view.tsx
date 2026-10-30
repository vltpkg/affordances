'use client'

import { ChevronRightIcon } from 'lucide-react'
import { Fragment, useState } from 'react'
import { cn } from 'cn'

type JsonViewProps = {
  value: unknown
  /** top-level or dotted keys (`entities.cart`, `actions.0`) whose value flashes when it changes */
  highlight?: string[]
  className?: string
}

type NodeProps = {
  name?: string
  value: unknown
  path: string
  highlight: string[]
  comma: boolean
}

// a tint behind the node each time its value changes; nothing on first render
const Changed = ({ value }: { value: unknown }) => {
  const serialized = JSON.stringify(value)
  const [seen, setSeen] = useState(serialized)
  const [changes, setChanges] = useState(0)
  if (serialized !== seen) {
    setSeen(serialized)
    setChanges(changes + 1)
  }
  if (!changes) return null
  // a new key restarts the animation; reduced motion steps it: on for the duration, then off
  return (
    <span
      key={changes}
      aria-hidden
      className="pointer-events-none absolute inset-y-0 right-0 -left-[2ch] -z-10 rounded-md animate-json-changed motion-reduce:[animation-timing-function:steps(1,end)]"
    />
  )
}

const Literal = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? (
    <span className="text-json-string">{JSON.stringify(value)}</span>
  ) : (
    <span className="text-json-literal">{String(value)}</span>
  )

const Node = ({ name, value, path, highlight, comma }: NodeProps) => {
  const [open, setOpen] = useState(true)
  const label = name !== undefined && (
    <>
      <span className="text-json-key">{JSON.stringify(name)}</span>
      {': '}
    </>
  )
  const tail = comma && ','
  const changed = highlight.includes(path) && <Changed value={value} />

  if (value === null || typeof value !== 'object')
    return (
      <div className={cn(changed && 'relative isolate')}>
        {changed}
        {label}
        <Literal value={value} />
        {tail}
      </div>
    )

  const list = Array.isArray(value)
  const entries = list
    ? value.map((v, i) => [String(i), v] as const)
    : Object.entries(value).filter(([, v]) => v !== undefined)
  const [start, end] = list ? ['[', ']'] : ['{', '}']

  // empty containers and lists of scalars (`effects`, `required`) stay on one line
  const inline =
    entries.every(([, v]) => v === null || typeof v !== 'object') && (list || !entries.length)
  if (inline)
    return (
      <div className={cn(changed && 'relative isolate')}>
        {changed}
        {label}
        {start}
        {entries.map(([key, v], i) => (
          <Fragment key={key}>
            {i > 0 && ', '}
            <Literal value={v} />
          </Fragment>
        ))}
        {end}
        {tail}
      </div>
    )

  // the root has no line to hang a toggle on, and nothing to hide it behind
  const root = path === ''
  return (
    <div className="relative isolate">
      {changed}
      <div className="relative">
        {!root && (
          <button
            type="button"
            aria-expanded={open}
            aria-label={path}
            onClick={() => setOpen(!open)}
            className="absolute top-0 -left-[2ch] flex h-5 w-[2ch] items-center justify-center rounded-md text-json-punctuation outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <ChevronRightIcon
              aria-hidden
              className={cn(
                'size-3 transition-transform duration-150 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none',
                open && 'rotate-90',
              )}
            />
          </button>
        )}
        {label}
        {start}
        {!open && (
          <>
            {'…'}
            {end}
            {tail}
          </>
        )}
      </div>
      {open && (
        <>
          <div className="pl-[2ch]">
            {entries.map(([key, v], i) => (
              <Node
                key={key}
                name={list ? undefined : key}
                value={v}
                path={root ? key : `${path}.${key}`}
                highlight={highlight}
                comma={i < entries.length - 1}
              />
            ))}
          </div>
          <div>
            {end}
            {tail}
          </div>
        </>
      )}
    </div>
  )
}

// a read-only view of an Affordances graph or delta; pure render, so it works on either side of the client boundary
export const JsonView = ({ value, highlight = [], className }: JsonViewProps) => (
  <div
    className={cn(
      'font-mono text-[13px] leading-5 whitespace-pre-wrap text-json-punctuation [overflow-wrap:anywhere]',
      className,
    )}
  >
    <Node value={value} path="" highlight={highlight} comma={false} />
  </div>
)

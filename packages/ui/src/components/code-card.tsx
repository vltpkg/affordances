'use client'

import { Tabs as TabsPrimitive } from '@base-ui/react/tabs'
import { BracesIcon, CheckIcon, CopyIcon, TerminalIcon } from 'lucide-react'
import { useState } from 'react'
import { cn } from 'cn'
import { Button } from '@afford/ui/components/button'
import { useCopy } from '@afford/ui/hooks/use-copy'

const shells = new Set(['bash', 'sh', 'shell', 'zsh', 'console'])
const names: Record<string, string> = {
  ts: 'TypeScript',
  tsx: 'TSX',
  js: 'JavaScript',
  json: 'JSON',
  markdown: 'Markdown',
  text: 'Text',
}

// `content` is what the <pre> shows: shiki's tokens from the server, or plain text
export type CodeTab = {
  code: string
  lang?: string
  title?: string
  content: React.ReactNode
}

type CodeCardProps = Omit<React.ComponentProps<'pre'>, 'children'> & {
  tabs: CodeTab[]
}

// the concave corner where the active tab meets the panel's top edge (16px, matching the panel's rounded-xl)
const Corner = ({ side }: { side: 'left' | 'right' }) => (
  <span
    className={cn(
      'absolute bottom-0 size-4 bg-(--code-editor-background)',
      side === 'left' ? '-left-4' : '-right-4',
    )}
  >
    <span
      className={cn(
        'block size-full border-b bg-card',
        side === 'left' ? 'rounded-br-xl border-r' : 'rounded-bl-xl border-l',
      )}
    />
  </span>
)

// a tab's label, plus the indicator that flows into the panel while it's active (`data-active` on the parent group)
const TabFace = ({
  tab: { lang = 'text', title },
  first,
  compact,
}: {
  tab: CodeTab
  first: boolean
  compact?: boolean
}) => {
  const terminal = shells.has(lang)
  const Icon = terminal ? TerminalIcon : BracesIcon
  return (
    <>
      <span
        aria-hidden
        className="absolute inset-x-0 top-1 -bottom-px hidden rounded-t-xl border-x border-t bg-(--code-editor-background) group-data-active:block"
      >
        {/* the first tab lines up with the panel's edge, so that side runs straight down */}
        {first ? (
          <span className="absolute -bottom-4 -left-px size-4 border-l bg-(--code-editor-background)" />
        ) : (
          <Corner side="left" />
        )}
        <Corner side="right" />
      </span>
      <span className="relative mt-1 flex h-10 items-center gap-1.5 rounded-lg px-3 font-mono text-xs whitespace-nowrap text-muted-foreground group-focus-visible:ring-2 group-focus-visible:ring-ring/50 group-data-active:text-foreground/75 group-not-data-active:group-hover:bg-foreground/5 group-not-data-active:group-hover:text-foreground">
        {/* a narrow card fits six tabs only without their icons */}
        <Icon
          aria-hidden
          className={cn(
            'size-3',
            terminal ? 'text-muted-foreground' : 'text-amber-600',
            compact && '@max-lg:hidden',
          )}
        />
        {title ?? (terminal ? 'Terminal' : (names[lang] ?? lang))}
      </span>
    </>
  )
}

// an editor card; more than one tab becomes a tablist whose active tab flows into the panel
export const CodeCard = ({ tabs, className, ...props }: CodeCardProps) => {
  const { copied, copy } = useCopy(1500)
  const [value, setValue] = useState(0)
  const active = tabs[value] ?? tabs[0]

  const pre = (tab: CodeTab) => (
    <pre
      className={cn(
        'flex-1 overflow-x-auto rounded-xl border bg-(--code-editor-background) p-4 font-mono text-[13px] leading-snug text-foreground [&_span]:text-(--shiki-light) dark:[&_span]:text-(--shiki-dark)',
        className,
      )}
      {...props}
    >
      {tab.content}
    </pre>
  )

  if (!active) return null

  return (
    <figure
      data-not-typeset
      className="@container relative flex flex-col overflow-hidden rounded-2xl border border-transparent bg-card px-1 pb-1 shadow-lg ring-1 shadow-black/6.5 ring-border-illustration backdrop-blur [--code-editor-background:var(--color-illustration)]"
    >
      {tabs.length === 1 ? (
        <>
          <figcaption data-active="" className="group relative h-11 w-fit">
            <TabFace tab={active} first />
          </figcaption>
          {pre(active)}
        </>
      ) : (
        <TabsPrimitive.Root value={value} onValueChange={(v: number) => setValue(v)}>
          <TabsPrimitive.List className="flex h-11 pr-9">
            {tabs.map((tab, i) => (
              <TabsPrimitive.Tab
                key={i}
                value={i}
                className="group relative h-11 shrink-0 outline-none"
              >
                <TabFace tab={tab} first={i === 0} compact />
              </TabsPrimitive.Tab>
            ))}
          </TabsPrimitive.List>
          {tabs.map((tab, i) => (
            <TabsPrimitive.Panel key={i} value={i} render={pre(tab)} />
          ))}
        </TabsPrimitive.Root>
      )}
      <Button
        variant="ghost"
        size="icon"
        onClick={() => copy(active.code)}
        aria-label={copied ? 'Copied' : 'Copy code'}
        className="absolute top-2 right-1.5 text-muted-foreground"
      >
        {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
      </Button>
    </figure>
  )
}

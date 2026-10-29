'use client'

import { useRef, useState } from 'react'
import { CheckIcon, ChevronDownIcon, CircleAlertIcon, CopyIcon } from 'lucide-react'
import { Button } from '@afford/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@afford/ui/components/dropdown-menu'
import { useCopy } from '@afford/ui/hooks/use-copy'

const item = 'min-h-8 px-2.5 text-sm text-muted-foreground'

// rendered only inside the open menu, so reading the origin never runs on the server.
// prompts link to the markdown twin rather than inlining it: query strings get long fast
const Links = ({ url }: { url: string }) => {
  const md = `${location.origin}${url}.md`
  const q = encodeURIComponent(`Read ${md} so I can ask questions about it.`)
  const links = [
    { label: 'View as Markdown', href: `${url}.md` },
    { label: 'Open in Claude', href: `https://claude.ai/new?q=${q}` },
    { label: 'Open in ChatGPT', href: `https://chatgpt.com/?hints=search&q=${q}` },
  ]
  return links.map(({ label, href }) => (
    <DropdownMenuItem
      key={href}
      className={item}
      render={
        <a href={href} target="_blank" rel="noopener noreferrer">
          {label}
        </a>
      }
    />
  ))
}

// a split button in the code card's dress: the card is the frame, the copy action its inset panel.
// what gets copied is the page's `/<url>.md` twin (see next.config.ts)
export const CopyPage = ({ url }: { url: string }) => {
  const { copied, copy } = useCopy(1500)
  const [failed, setFailed] = useState(false)
  const markdown = useRef<Promise<string>>(null)

  // fetch on hover/focus so the click only awaits a settled promise; Safari drops clipboard writes that
  // happen too long after the click. a failed fetch is forgotten, so the next attempt retries
  const load = () =>
    (markdown.current ??= fetch(`${url}.md`)
      .then((res) => {
        if (!res.ok) throw new Error(`${url}.md: ${res.status}`)
        return res.text()
      })
      .catch((error: unknown) => {
        markdown.current = null
        throw error
      }))
  const preload = () => void load().catch(() => {})
  const copyPage = () => {
    setFailed(false)
    load().then(copy, () => setFailed(true))
  }

  return (
    <div
      data-not-typeset
      className="flex shrink-0 items-center gap-0.5 rounded-xl bg-card p-0.5 ring-1 ring-border-illustration"
    >
      <Button
        variant="outline"
        size="sm"
        onPointerEnter={preload}
        onFocus={preload}
        onClick={copyPage}
        className="rounded-[calc(var(--radius-xl)-2px)] bg-illustration text-foreground/75 hover:text-foreground active:not-aria-[haspopup]:translate-y-0 dark:bg-illustration"
      >
        {/* the label keeps its width; only the icon confirms, so the frame never resizes */}
        {failed ? (
          <CircleAlertIcon aria-hidden className="text-destructive" />
        ) : copied ? (
          <CheckIcon aria-hidden />
        ) : (
          <CopyIcon aria-hidden />
        )}
        Copy page
        <span aria-live="polite" className="sr-only">
          {failed ? 'Couldn’t load the page’s Markdown' : ''}
        </span>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="More page actions"
              className="rounded-[calc(var(--radius-xl)-2px)] text-muted-foreground data-popup-open:bg-foreground/5 data-popup-open:text-foreground"
            />
          }
        >
          <ChevronDownIcon aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={8} className="w-48 rounded-xl">
          <Links url={url} />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

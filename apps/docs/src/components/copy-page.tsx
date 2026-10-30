'use client'

import { useRef, useState } from 'react'
import { CheckIcon, ChevronRightIcon, CircleAlertIcon, CopyIcon, TerminalIcon } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@affordances/ui/components/dropdown-menu'
import { useCopy } from '@affordances/ui/hooks/use-copy'
import { Claude } from '@/components/icons/claude'
import { Markdown } from '@/components/icons/markdown'
import { OpenAI } from '@/components/icons/openai'
import { Button } from '@/components/ui/button'

const item =
  'text-muted-foreground flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:bg-foreground/5 focus:text-foreground data-highlighted:bg-foreground/5 data-highlighted:text-foreground [&_svg]:size-4'

const MenuLink = ({
  href,
  external = true,
  children,
}: {
  href: string
  external?: boolean
  children: React.ReactNode
}) => (
  <DropdownMenuItem
    className={item}
    render={
      <a href={href} {...(external && { target: '_blank', rel: 'noopener noreferrer' })}>
        {children}
      </a>
    }
  />
)

// prompts stay short and link to the markdown twin: query strings get long fast (claude-cli:// caps q at 5,000 chars).
// rendered only inside the open menu, so reading the origin never runs on the server
const AiActions = ({ url }: { url: string }) => {
  const md = `${window.location.origin}${url}.md`
  const q = encodeURIComponent(`Read ${md} so I can ask questions about it.`)
  // claude-cli://open starts in the home directory, so have it ask for the project first
  const cli = encodeURIComponent(
    `Read ${md} from the Affordances docs. Before changing anything, ask me which project to work in.`,
  )
  return (
    <>
      <DropdownMenuSeparator className="-mx-1 my-1 h-px bg-border-illustration" />
      <MenuLink href={`https://claude.ai/new?q=${q}`}>
        <Claude aria-hidden />
        Open in Claude
      </MenuLink>
      <MenuLink href={`https://chatgpt.com/?hints=search&q=${q}`}>
        <OpenAI aria-hidden />
        Open in ChatGPT
      </MenuLink>
      <MenuLink href={`claude-cli://open?q=${cli}`} external={false}>
        <TerminalIcon aria-hidden />
        Open in Claude Code
      </MenuLink>
    </>
  )
}

// a split button in the code card's dress: the card is the frame, the copy action its inset panel, its corners
// the frame's radius less the padding. the page's `/<url>.md` twin (see next.config.ts rewrites) is what gets
// copied, viewed and linked
export const CopyPage = ({ url }: { url: string }) => {
  const { copied, copy } = useCopy(1500)
  const [failed, setFailed] = useState(false)
  const markdown = useRef<Promise<string>>(null)

  // fetch on hover/focus so the copy only awaits an already-settled promise;
  // Safari drops clipboard writes that happen too long after the click.
  // a failed fetch is forgotten, so the next hover or click retries instead of reusing it
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
  // the click reports a failure; a failed preload has nobody to tell
  const preload = () => void load().catch(() => {})
  const copyPage = () => {
    setFailed(false)
    load().then(copy, () => setFailed(true))
  }

  return (
    <div
      data-not-typeset
      className="flex shrink-0 items-center gap-0.5 rounded-xl bg-card p-0.5 shadow-lg ring-1 shadow-black/6.5 ring-border-illustration"
    >
      <Button
        variant="outline"
        size="sm"
        onPointerEnter={preload}
        onFocus={preload}
        onClick={copyPage}
        className="rounded-[calc(var(--radius-xl)-2px)] bg-illustration text-foreground/75 hover:text-foreground active:not-aria-[haspopup]:translate-y-0"
      >
        {failed ? (
          <CircleAlertIcon aria-hidden className="text-destructive" />
        ) : copied ? (
          <CheckIcon aria-hidden />
        ) : (
          <CopyIcon aria-hidden />
        )}
        {/* the label keeps its width (only the icon confirms, with use-copy's toast), so the frame never resizes */}
        Copy Page
        <span aria-live="polite" className="sr-only">
          {failed ? 'Failed to copy the page' : ''}
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
          <ChevronRightIcon
            aria-hidden
            className="transition-transform duration-200 ease-out group-data-popup-open/button:rotate-90 motion-reduce:transition-none"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          sideOffset={8}
          className="z-50 w-auto min-w-52 rounded-xl bg-card p-1 shadow-lg ring-1 shadow-black/6.5 ring-border-illustration"
        >
          <MenuLink href={`${url}.md`}>
            <Markdown aria-hidden />
            View as Markdown
          </MenuLink>
          <AiActions url={url} />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

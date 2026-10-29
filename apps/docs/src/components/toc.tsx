'use client'

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import {
  AnchorProvider,
  ScrollProvider,
  TOCItem,
  useActiveAnchors,
  type TOCItemType,
} from 'fumadocs-core/toc'
import { ChevronDownIcon, PencilIcon } from 'lucide-react'

const pad = (el: HTMLElement, side: 'paddingTop' | 'paddingBottom') =>
  parseFloat(getComputedStyle(el)[side])

const headings = (toc: TOCItemType[]) => toc.filter((item) => item.depth === 2 || item.depth === 3)

// the url of the section being read; call inside an AnchorProvider
const useActiveUrl = (items: TOCItemType[]) => {
  // visible anchors come in document order; the topmost is the section being read
  const [anchor] = useActiveAnchors()
  // the last headings can never reach the top of the viewport, so the bottom of the page claims the last one
  const [atEnd, setAtEnd] = useState(false)
  useEffect(() => {
    const update = () =>
      setAtEnd(scrollY > 0 && innerHeight + scrollY >= document.documentElement.scrollHeight - 1)
    update()
    addEventListener('scroll', update, { passive: true })
    return () => removeEventListener('scroll', update)
  }, [])
  return atEnd ? items.at(-1)?.url : anchor && `#${anchor}`
}

const Items = ({ items }: { items: TOCItemType[] }) => {
  const active = useActiveUrl(items)
  return (
    <ul>
      {items.map((item) => (
        <li key={item.url}>
          <TOCItem
            href={item.url}
            aria-current={item.url === active ? 'location' : undefined}
            className={`block rounded-sm py-1 text-[0.8125rem] leading-5 [overflow-wrap:anywhere] text-muted-foreground outline-none transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 aria-[current]:text-foreground [&_code]:font-mono [&_code]:text-xs ${item.depth === 3 ? 'pl-3' : ''}`}
          >
            {item.title}
          </TOCItem>
        </li>
      ))}
    </ul>
  )
}

export const Toc = ({ toc, editUrl }: { toc: TOCItemType[]; editUrl?: string }) => {
  const scroller = useRef<HTMLDivElement>(null)
  const items = headings(toc)

  return (
    <aside className="sticky top-[calc(var(--header-height)+3rem)] flex max-h-[calc(100svh-var(--header-height)-6rem)] w-56 flex-col gap-5">
      {items.length > 0 && (
        <nav aria-label="On this page" className="flex min-h-0 flex-col gap-3">
          <p className="font-pixel text-xs text-muted-foreground">On this page</p>
          {/* px-2 gives the focus ring room inside the scroll container's clip */}
          <div ref={scroller} className="-mx-2 min-h-0 overflow-y-auto px-2">
            <AnchorProvider toc={items}>
              <ScrollProvider containerRef={scroller}>
                <Items items={items} />
              </ScrollProvider>
            </AnchorProvider>
          </div>
        </nav>
      )}
      {editUrl && (
        <a
          href={editUrl}
          className="inline-flex w-fit shrink-0 items-center gap-2 rounded-sm text-[0.8125rem] text-muted-foreground outline-none transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <PencilIcon aria-hidden className="size-3.5" />
          Edit this page
        </a>
      )}
    </aside>
  )
}

const Bar = ({ items }: { items: TOCItemType[] }) => {
  const active = useActiveUrl(items)
  const current = items.find((item) => item.url === active)
  const [open, setOpen] = useState(false)
  const id = useId()
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const ring = useRef<SVGCircleElement>(null)
  const read = useRef<HTMLSpanElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const fill = useRef<HTMLSpanElement>(null)
  const dot = useRef<HTMLSpanElement>(null)

  // measured from the links (offsets stay valid while the panel is closed or scrolled), redone when wrapping changes
  useLayoutEffect(() => {
    const box = list.current
    if (!box) return
    const draw = () => {
      const first = box.querySelector('a')
      const link = active ? box.querySelector<HTMLElement>(`a[href="${CSS.escape(active)}"]`) : null
      if (!fill.current || !dot.current) return
      // before the first heading nothing is filled
      if (!first || !link) {
        fill.current.style.transform = 'scaleY(0)'
        dot.current.style.opacity = '0'
        return
      }
      const start = first.offsetTop + pad(first, 'paddingTop')
      const end = link.offsetTop + link.offsetHeight - pad(link, 'paddingBottom')
      fill.current.style.transform = `translateY(${start}px) scaleY(${(end - start) / box.clientHeight})`
      dot.current.style.transform = `translateY(${end - 2.5}px)`
      dot.current.style.opacity = '1'
    }
    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(box)
    return () => observer.disconnect()
  }, [active])

  // written straight to the dom once a frame: no re-render per scroll event
  useEffect(() => {
    let frame = 0
    const draw = () => {
      frame = 0
      const max = document.documentElement.scrollHeight - innerHeight
      const progress = max > 0 ? Math.min(Math.max(scrollY / max, 0), 1) : 1
      ring.current?.style.setProperty('stroke-dashoffset', String(1 - progress))
      if (read.current) read.current.textContent = `${Math.round(progress * 100)}% read`
    }
    const schedule = () => {
      frame ||= requestAnimationFrame(draw)
    }
    draw()
    addEventListener('scroll', schedule, { passive: true })
    addEventListener('resize', schedule)
    return () => {
      cancelAnimationFrame(frame)
      removeEventListener('scroll', schedule)
      removeEventListener('resize', schedule)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      button.current?.focus()
    }
    const onPointer = (e: PointerEvent) => {
      if (e.target instanceof Node && !root.current?.contains(e.target)) setOpen(false)
    }
    addEventListener('keydown', onKey)
    addEventListener('pointerdown', onPointer)
    return () => {
      removeEventListener('keydown', onKey)
      removeEventListener('pointerdown', onPointer)
    }
  }, [open])

  // bleeds over SidebarInset's padding (px-4 py-8 md:px-16 md:py-12) so it spans the content area; the inner
  // max-w lines everything up with the article column
  return (
    <div
      ref={root}
      data-toc-bar
      className="sticky top-(--header-height) z-40 -mx-4 -mt-8 mb-8 md:-mx-16 md:-mt-12 md:mb-12 xl:hidden"
    >
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className="group relative flex h-12 w-full border-b bg-background px-4 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset md:px-16"
      >
        <span className="mx-auto flex w-full max-w-[37em] items-center gap-3">
          <svg aria-hidden viewBox="0 0 20 20" className="size-5 shrink-0 -rotate-90">
            <circle
              cx="10"
              cy="10"
              r="8.25"
              strokeWidth="1.5"
              className="fill-transparent stroke-border"
            />
            <circle
              ref={ring}
              cx="10"
              cy="10"
              r="8.25"
              strokeWidth="1.5"
              pathLength={1}
              strokeDasharray={1}
              strokeDashoffset={1}
              strokeLinecap="round"
              className="fill-none stroke-progress"
            />
          </svg>
          <span className="min-w-0 flex-1 truncate text-left text-sm text-muted-foreground transition-colors duration-150 group-aria-expanded:text-foreground [&_code]:font-mono [&_code]:text-xs">
            {current?.title ?? 'On this page'}
          </span>
          <span ref={read} className="sr-only">
            0% read
          </span>
          <ChevronDownIcon
            aria-hidden
            className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-out group-aria-expanded:rotate-180 motion-reduce:transition-none"
          />
        </span>
      </button>
      {/* clip + fade from the bar's edge; visibility keeps the closed links out of the tab order */}
      <nav
        id={id}
        aria-label="On this page"
        data-open={open}
        className="invisible absolute inset-x-0 top-full border-b bg-background opacity-0 transition-[clip-path,opacity,visibility] duration-150 ease-out [clip-path:inset(0_0_100%_0)] data-[open=true]:visible data-[open=true]:opacity-100 data-[open=true]:duration-200 data-[open=true]:[clip-path:inset(0)] motion-reduce:transition-none"
      >
        <div ref={scroller} className="max-h-[60svh] overflow-y-auto px-4 py-3 md:px-16">
          <ScrollProvider containerRef={scroller}>
            <div ref={list} className="relative mx-auto max-w-[37em] border-l">
              <ul>
                {items.map((item) => (
                  <li key={item.url}>
                    <TOCItem
                      href={item.url}
                      onClick={() => setOpen(false)}
                      aria-current={item.url === active ? 'location' : undefined}
                      className={`relative block py-1.5 text-sm leading-5 [overflow-wrap:anywhere] text-muted-foreground outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/50 aria-[current]:text-progress [&_code]:font-mono [&_code]:text-xs ${item.depth === 3 ? 'pl-7' : 'pl-4'}`}
                    >
                      {item.title}
                    </TOCItem>
                  </li>
                ))}
              </ul>
              {/* progress on the guide line, from the first label to the end of the current one, dot at the end.
                  transformed rather than resized so the change animates on the compositor */}
              <span
                ref={fill}
                aria-hidden
                style={{ transform: 'scaleY(0)' }}
                className="absolute top-0 -left-px h-full w-px origin-top bg-progress transition-transform duration-200 ease-out motion-reduce:transition-none"
              />
              <span
                ref={dot}
                aria-hidden
                className="absolute top-0 -left-[3px] size-[5px] rounded-full bg-progress opacity-0 transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-none"
              />
            </div>
          </ScrollProvider>
        </div>
      </nav>
    </div>
  )
}

// the mobile and tablet counterpart of the rail: a bar pinned under the navbar that opens into the toc
export const TocBar = ({ toc }: { toc: TOCItemType[] }) => {
  const items = headings(toc)
  if (items.length === 0) return null
  return (
    <AnchorProvider toc={items}>
      <Bar items={items} />
    </AnchorProvider>
  )
}

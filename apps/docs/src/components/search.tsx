'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import { FileTextIcon, HashIcon, LoaderCircleIcon, SearchIcon, TextIcon } from 'lucide-react'
import type { SortedResult } from 'fumadocs-core/search'
import { cn } from 'cn'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@afford/ui/components/command'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@afford/ui/components/dialog'

const icons = { page: FileTextIcon, heading: HashIcon, text: TextIcon }

export type SuggestionGroup = { title: string; pages: { title: string; url: string }[] }

// content is markdown with <mark> around matches; render as text, never as html
const Highlighted = ({ text }: { text: string }) =>
  text
    .replace(/`|\*\*/g, '')
    .split(/<mark>(.*?)<\/mark>/g)
    .map((part, i) =>
      i % 2 ? (
        <mark key={i} className="bg-transparent text-foreground">
          {part}
        </mark>
      ) : (
        part
      ),
    )

// server renders the Mac glyph; other platforms swap to Ctrl after hydration
const useIsMac = () =>
  useSyncExternalStore(
    () => () => {},
    () => /Mac|iPhone|iPad/.test(navigator.userAgent),
    () => true,
  )

type Results = { query: string; results: SortedResult[] } | { query: string; error: true }

// debounced, and a newer query aborts the one in flight
const useSearch = (query: string) => {
  const [state, setState] = useState<Results | null>(null)
  useEffect(() => {
    if (!query) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      fetch(`/api/search?query=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
        .then((results: SortedResult[]) => setState({ query, results }))
        .catch(() => {
          if (!controller.signal.aborted) setState({ query, error: true })
        })
    }, 100)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query])
  return state?.query === query ? state : null
}

export const Search = ({ suggestions }: { suggestions: SuggestionGroup[] }) => {
  const router = useRouter()
  const mac = useIsMac()
  const trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState('')
  const state = useSearch(search)
  const loading = !!search && !state
  const results = state && 'results' in state ? state.results : undefined

  // results arrive after the keystroke, so cmdk can't auto-select them; select the top hit ourselves
  const [shown, setShown] = useState(results)
  if (results !== shown) {
    setShown(results)
    setSelected(results?.[0]?.id ?? '')
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((value) => !value)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  const go = (url: string) => {
    router.push(url)
    setOpen(false)
  }

  const item = 'min-h-9 gap-2.5 px-3 text-sm data-selected:bg-accent'

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-keyshortcuts="Meta+K Control+K"
        onClick={() => setOpen(true)}
        className="flex h-8 items-center gap-2 rounded-lg border bg-card px-2.5 text-sm text-muted-foreground outline-none transition-colors duration-150 hover:border-foreground/20 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 max-sm:size-8 max-sm:justify-center max-sm:border-transparent max-sm:bg-transparent max-sm:px-0 sm:w-56 [&_svg]:size-4"
      >
        <SearchIcon aria-hidden />
        <span className="max-sm:sr-only">Search docs</span>
        <kbd
          aria-hidden
          className="ml-auto flex h-5 items-center rounded-md border px-1.5 font-sans text-xs max-sm:hidden pointer-coarse:hidden"
        >
          {mac ? '⌘' : 'Ctrl '}K
        </kbd>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton={false}
          finalFocus={trigger}
          className="top-[12vh] translate-y-0 gap-0 overflow-hidden p-0 data-open:duration-150 data-open:ease-out data-open:zoom-in-[0.98] data-closed:duration-100 data-closed:zoom-out-100 motion-reduce:data-open:zoom-in-100 sm:max-w-xl"
        >
          <DialogTitle className="sr-only">Search docs</DialogTitle>
          <DialogDescription className="sr-only">
            Search pages, headings, and content.
          </DialogDescription>
          <Command
            shouldFilter={false}
            // with an empty query, highlight the first suggestion so Enter works straight away
            value={search ? selected : selected || (suggestions[0]?.pages[0]?.url ?? '')}
            onValueChange={setSelected}
            className="rounded-none bg-transparent p-0 **:data-[slot=command-input-wrapper]:p-0 **:data-[slot=input-group]:h-12! **:data-[slot=input-group]:rounded-none **:data-[slot=input-group]:border-0 **:data-[slot=input-group]:bg-transparent! **:data-[slot=input-group]:px-2 **:data-[slot=input-group]:ring-0! [&_[data-slot=input-group]_svg]:size-4!"
          >
            <div className="relative">
              <CommandInput
                value={search}
                onValueChange={setSearch}
                placeholder="Search docs"
                className="text-base text-foreground placeholder:text-muted-foreground md:text-sm"
              />
              {loading && (
                // appears only if a search outlasts 300ms, so fast responses never flash it
                <output className="absolute top-1/2 right-4 -translate-y-1/2 text-muted-foreground animate-in fade-in-0 delay-300 fill-mode-backwards">
                  <LoaderCircleIcon
                    aria-hidden
                    className="size-4 animate-spin motion-reduce:animate-none"
                  />
                  <span className="sr-only">Searching</span>
                </output>
              )}
            </div>
            {!search && (
              <CommandList className="max-h-[min(26rem,60vh)] border-t p-2">
                {suggestions.map((group) => (
                  <CommandGroup
                    key={group.title}
                    heading={group.title}
                    className="p-0 not-first:mt-1 **:[[cmdk-group-heading]]:px-3 **:[[cmdk-group-heading]]:font-pixel **:[[cmdk-group-heading]]:font-normal"
                  >
                    {group.pages.map((page) => (
                      <CommandItem
                        key={page.url}
                        value={page.url}
                        onSelect={() => go(page.url)}
                        className={item}
                      >
                        <FileTextIcon aria-hidden className="text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate">{page.title}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ))}
              </CommandList>
            )}
            {search && state && (
              <CommandList className="max-h-[min(26rem,60vh)] border-t p-2">
                {'error' in state ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    Search is unavailable right now.
                  </p>
                ) : (
                  <CommandEmpty className="py-8 text-sm text-muted-foreground">
                    No results.
                  </CommandEmpty>
                )}
                {results?.map((result) => {
                  const Icon = icons[result.type]
                  return (
                    <CommandItem
                      key={result.id}
                      value={result.id}
                      onSelect={() => go(result.url)}
                      className={cn(
                        item,
                        result.type === 'page'
                          ? 'text-foreground'
                          : 'pl-9 text-muted-foreground data-selected:text-foreground',
                      )}
                    >
                      <Icon aria-hidden className="text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">
                        <Highlighted text={result.content} />
                      </span>
                    </CommandItem>
                  )
                })}
              </CommandList>
            )}
          </Command>
        </DialogContent>
      </Dialog>
    </>
  )
}

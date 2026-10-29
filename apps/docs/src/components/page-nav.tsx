import Link from 'next/link'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { flattenTree } from 'fumadocs-core/page-tree'
import { source } from '@/lib/source'
import { Rule } from '@/components/rule'

// sidebar order
const pages = flattenTree(source.pageTree.children)

const card =
  'group flex items-center gap-3 rounded-xl px-4 py-3.5 no-underline! outline-none transition-colors duration-150 hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50'
const chevron =
  'size-4 shrink-0 text-muted-foreground transition-transform duration-150 ease-out group-hover:text-foreground motion-reduce:transition-none'

export const PageNav = ({ url }: { url: string }) => {
  const i = pages.findIndex((page) => page.url === url)
  if (i === -1) return null
  const previous = pages[i - 1]
  const next = pages[i + 1]

  return (
    <>
      <Rule />
      <nav aria-label="Pagination" className="grid gap-2 pt-6 sm:grid-cols-2">
        {previous && (
          <Link href={previous.url} rel="prev" className={card}>
            <ChevronLeftIcon aria-hidden className={`${chevron} group-hover:-translate-x-0.5`} />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">Previous</span>
              <span className="truncate font-medium text-foreground">{previous.name}</span>
            </span>
          </Link>
        )}
        {next && (
          <Link
            href={next.url}
            rel="next"
            className={`${card} justify-end text-right sm:col-start-2`}
          >
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">Next</span>
              <span className="truncate font-medium text-foreground">{next.name}</span>
            </span>
            <ChevronRightIcon aria-hidden className={`${chevron} group-hover:translate-x-0.5`} />
          </Link>
        )}
      </nav>
    </>
  )
}

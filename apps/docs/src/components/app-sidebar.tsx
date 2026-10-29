'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Sidebar, useSidebar } from '@/components/ui/sidebar'
import type { SuggestionGroup } from '@/components/search'

// the page tree as groups under pixel labels; the tree is shallow, so every page is one click away
export const AppSidebar = ({
  groups,
  className,
}: {
  groups: SuggestionGroup[]
  className?: string
}) => {
  const pathname = usePathname()
  const { setOpenMobile } = useSidebar()

  return (
    <Sidebar className={className}>
      <nav aria-label="Docs" className="flex flex-col gap-6 px-3 py-6 md:px-4 md:py-8">
        {groups.map((group) => (
          <div key={group.title}>
            <p className="font-pixel px-3 pb-2 text-xs text-muted-foreground">{group.title}</p>
            <ul>
              {group.pages.map((page) => (
                <li key={page.url}>
                  <Link
                    href={page.url}
                    aria-current={page.url === pathname ? 'page' : undefined}
                    onClick={() => setOpenMobile(false)}
                    className="flex h-8 items-center rounded-lg px-3 text-sm text-foreground/70 outline-none transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 aria-[current=page]:bg-sidebar-accent aria-[current=page]:font-medium aria-[current=page]:text-foreground"
                  >
                    {page.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </Sidebar>
  )
}

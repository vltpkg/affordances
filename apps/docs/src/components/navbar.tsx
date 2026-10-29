import Link from 'next/link'
import { Wordmark } from '@afford/ui/components/wordmark'
import { Search } from '@/components/search'
import { ThemeSwitcher } from '@/components/theme-switcher'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { sections } from '@/lib/source'

const link =
  'rounded-md px-2 py-1 text-sm text-muted-foreground outline-none transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50'

// `sidebar` adds the trigger for the docs sheet below md; it needs the docs layout's SidebarProvider
export const Navbar = ({ sidebar }: { sidebar?: boolean }) => (
  <header className="sticky top-0 z-50 w-full border-b bg-background">
    <nav aria-label="Main" className="flex h-(--header-height) items-center gap-2 px-3 md:px-4">
      {sidebar && <SidebarTrigger className="-ml-1 md:hidden" />}
      <Link
        href="/"
        aria-label="Afford home"
        className="rounded-md px-1 py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <Wordmark />
      </Link>
      <div className="ml-auto flex items-center gap-1">
        <Link href="/why" className={`${link} max-sm:hidden`}>
          Docs
        </Link>
        <a href="https://github.com/afford/afford" className={`${link} mr-1 max-sm:hidden`}>
          GitHub
        </a>
        <Search suggestions={sections()} />
        <ThemeSwitcher />
      </div>
    </nav>
  </header>
)

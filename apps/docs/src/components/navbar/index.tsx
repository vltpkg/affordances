'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from 'cn'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { isCurrent, links } from './data'
import { Logo } from './logo'
import { MobileMenu } from './mobile-menu'

// vlt's docs header, flat: the logo, then the docs' sections
// `sidebar`: the docs shell, whose SidebarProvider the mobile trigger needs; the marketing page has none
export const Navbar = ({
  className,
  sidebar,
  ...props
}: React.ComponentProps<'header'> & { sidebar?: boolean }) => {
  const pathname = usePathname()
  return (
    <header className={cn('sticky top-0 z-50 w-full', className)} {...props}>
      <nav
        className="flex h-(--header-height) w-full items-center justify-between gap-3 border-b border-border bg-background px-3"
        aria-label="Main navigation"
      >
        <div className="flex items-center gap-2">
          {/* opens the docs sidebar sheet on mobile */}
          {sidebar && <SidebarTrigger className="md:hidden" />}
          <Logo />
        </div>
        <ul className="hidden items-center lg:flex">
          {links.map(({ label, href }) => (
            <li key={href}>
              <Link
                href={href}
                aria-current={isCurrent(href, pathname) ? 'page' : undefined}
                className="inline-flex h-9 items-center rounded-md px-4 text-sm font-medium outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-[current=page]:bg-accent/60"
              >
                {label}
              </Link>
            </li>
          ))}
        </ul>
        <MobileMenu />
      </nav>
    </header>
  )
}

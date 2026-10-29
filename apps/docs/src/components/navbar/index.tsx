'use client'

import Link from 'next/link'
import { cn } from 'cn'
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from '@afford/ui/components/navigation-menu'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { getMenuContent } from './data'
import { Logo } from './logo'
import { isGroup, isItem } from './types'
import { MenuGroupContent } from './menu-group-content'
import { MobileMenu } from './mobile-menu'

const isExternalLink = (href: string) => href.startsWith('http://') || href.startsWith('https://')

const menuContent = getMenuContent()

// vlt.io's marketing header in its flat `disableScrollEffect` form: no float-on-scroll, auth, or package search
export const Navbar = ({ className, ...props }: React.ComponentProps<'header'>) => (
  <header className={cn('sticky top-0 z-50 w-full', className)} {...props}>
    <nav
      className="flex h-(--header-height) w-full items-center justify-between gap-3 border-b border-border bg-background px-3"
      aria-label="Main navigation"
    >
      <div className="flex items-center gap-2">
        {/* opens the docs sidebar sheet on mobile */}
        <SidebarTrigger className="md:hidden" />
        <Logo />
      </div>
      <div className="hidden items-center gap-2 lg:flex">
        <NavigationMenu popupClassName="bg-white dark:bg-black">
          <NavigationMenuList>
            {menuContent.map((item, i) => {
              if (isGroup(item))
                return (
                  <NavigationMenuItem key={i}>
                    <NavigationMenuTrigger
                      className={cn('bg-transparent', item.hiddenDesktop && 'hidden')}
                    >
                      {item.group}
                    </NavigationMenuTrigger>
                    <MenuGroupContent group={item} />
                  </NavigationMenuItem>
                )
              if (isItem(item)) {
                const isExternal = isExternalLink(item.path)
                return (
                  <NavigationMenuItem key={i}>
                    <NavigationMenuLink
                      className="rounded-md px-4 py-2 font-medium hover:bg-accent"
                      {...(isExternal
                        ? { href: item.path, target: item.target, rel: 'noopener noreferrer' }
                        : { render: <Link href={item.path} /> })}
                    >
                      {item.label}
                      {item.target === '_blank' && (
                        <span className="sr-only"> (opens in new window)</span>
                      )}
                    </NavigationMenuLink>
                  </NavigationMenuItem>
                )
              }
              return null
            })}
          </NavigationMenuList>
        </NavigationMenu>
      </div>
      <MobileMenu menuData={menuContent} />
    </nav>
  </header>
)

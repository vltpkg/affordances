'use client'

import { Fragment, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import Link from 'next/link'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@afford/ui/components/sheet'
import { Button } from '@/components/ui/button'
import { Logo } from './logo'
import { toSections } from './types'
import type { MenuData, MenuItem } from './types'

const renderItem = (item: MenuItem, onNavigate: () => void): ReactNode => {
  const isExternal = item.target === '_blank'
  const Icon = item.icon

  return (
    <Button
      key={item.path}
      asChild
      variant="ghost"
      className="w-full justify-start font-medium text-foreground hover:text-foreground"
    >
      <Link
        href={item.path}
        target={item.target}
        rel={isExternal ? 'noopener noreferrer' : undefined}
        onClick={onNavigate}
      >
        {Icon && (
          <div className="flex size-5 shrink-0 items-center justify-center rounded-sm outline-1 outline-border">
            <Icon className="size-3.5 text-muted-foreground" aria-hidden="true" />
          </div>
        )}
        <span>{item.label}</span>
      </Link>
    </Button>
  )
}

// vlt.io's mobile drawer, as a bottom sheet; no auth or socials
export const MobileMenu = ({ menuData }: { menuData: MenuData[] }) => {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  const sections = useMemo(() => toSections(menuData), [menuData])

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={<Button size="sm" className="lg:hidden" variant="outline" aria-label="Open menu" />}
      >
        Menu
      </SheetTrigger>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="max-h-[85svh] gap-0 bg-background text-sm text-foreground"
      >
        <SheetTitle className="sr-only">Mobile menu</SheetTitle>
        <SheetDescription className="sr-only">Site navigation</SheetDescription>

        <SheetHeader className="flex w-full flex-row items-center border-b border-border p-3 text-left">
          <Logo onClick={close} />
        </SheetHeader>

        <nav className="flex flex-1 flex-col overflow-y-auto p-3" aria-label="Mobile navigation">
          {sections.map((section, i) => (
            <Fragment key={section.label ?? `__standalone-${i}`}>
              {i > 0 && <hr className="-mx-3 my-2 border-border" />}
              {section.label && (
                <div className="px-4 py-2 text-sm font-medium text-muted-foreground">
                  {section.label}
                </div>
              )}
              <div className="flex flex-col gap-0.5">
                {section.items.map((item) => renderItem(item, close))}
              </div>
            </Fragment>
          ))}
        </nav>
      </SheetContent>
    </Sheet>
  )
}

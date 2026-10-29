'use client'

import { useState } from 'react'
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
import { links } from './data'
import { Logo } from './logo'

// vlt.io's mobile drawer, as a bottom sheet: the header's links, one per row
export const MobileMenu = () => {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)

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

        <nav className="flex flex-col gap-0.5 overflow-y-auto p-3" aria-label="Mobile navigation">
          {links.map(({ label, href }) => (
            <Button
              key={href}
              asChild
              variant="ghost"
              className="w-full justify-start font-medium text-foreground hover:text-foreground"
            >
              <Link href={href} onClick={close}>
                {label}
              </Link>
            </Button>
          ))}
        </nav>
      </SheetContent>
    </Sheet>
  )
}

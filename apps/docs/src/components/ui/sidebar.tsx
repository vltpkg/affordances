'use client'

import { createContext, use, useState } from 'react'
import { PanelLeftIcon } from 'lucide-react'
import { cn } from 'cn'
import { Button } from '@afford/ui/components/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@afford/ui/components/sheet'
import { useMedia } from '@/hooks/use-media'

// the slice of shadcn's sidebar this site uses: a fixed column on desktop, a sheet below md
type SidebarContext = { openMobile: boolean; setOpenMobile: (open: boolean) => void }

const Context = createContext<SidebarContext | null>(null)

export const useSidebar = () => {
  const context = use(Context)
  if (!context) throw new Error('useSidebar must be used within a SidebarProvider')
  return context
}

export const SidebarProvider = ({ className, ...props }: React.ComponentProps<'div'>) => {
  const [openMobile, setOpenMobile] = useState(false)
  return (
    <Context value={{ openMobile, setOpenMobile }}>
      <div
        data-slot="sidebar-wrapper"
        className={cn('flex min-h-svh w-full', className)}
        {...props}
      />
    </Context>
  )
}

export const Sidebar = ({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) => {
  const { openMobile, setOpenMobile } = useSidebar()
  const mobile = useMedia('(width < 48rem)')

  if (mobile)
    return (
      <Sheet open={openMobile} onOpenChange={setOpenMobile}>
        <SheetContent
          side="left"
          showCloseButton={false}
          className="w-(--sidebar-width) bg-background p-0 text-foreground"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Navigation</SheetTitle>
            <SheetDescription>Pages in the Afford docs</SheetDescription>
          </SheetHeader>
          <div className="flex h-full flex-col overflow-y-auto">{children}</div>
        </SheetContent>
      </Sheet>
    )

  return (
    <div className="hidden md:block">
      {/* holds the sidebar's width in the row, since the sidebar itself is fixed */}
      <div className="w-(--sidebar-width)" />
      <aside
        className={cn(
          'fixed inset-y-0 left-0 hidden w-(--sidebar-width) flex-col overflow-y-auto md:flex',
          className,
        )}
      >
        {children}
      </aside>
    </div>
  )
}

export const SidebarInset = ({ className, ...props }: React.ComponentProps<'main'>) => (
  <main className={cn('relative flex min-w-0 flex-1 flex-col', className)} {...props} />
)

export const SidebarTrigger = ({ className }: { className?: string }) => {
  const { openMobile, setOpenMobile } = useSidebar()
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Open navigation"
      aria-expanded={openMobile}
      onClick={() => setOpenMobile(!openMobile)}
      className={className}
    >
      <PanelLeftIcon aria-hidden />
    </Button>
  )
}

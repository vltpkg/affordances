'use client'

import { cn } from 'cn'
import { Button } from '@afford/ui/components/button'
import { useScrolled } from '@/hooks/use-scrolled'

export const ScrollToTop = ({ className }: { className?: string }) => {
  const scrolled = useScrolled()
  return (
    <Button
      size="sm"
      variant="outline"
      tabIndex={scrolled ? 0 : -1}
      aria-hidden={!scrolled}
      data-open={scrolled}
      onClick={() => scrollTo({ top: 0 })}
      className={cn(
        'font-pixel fixed inset-x-0 mx-auto w-fit -translate-y-1 bg-background text-xs opacity-0 transition-[opacity,translate] duration-150 ease-out pointer-events-none data-[open=true]:pointer-events-auto data-[open=true]:translate-y-0 data-[open=true]:opacity-100 motion-reduce:transition-none dark:bg-background dark:hover:bg-muted',
        className,
      )}
    >
      Back to top
    </Button>
  )
}

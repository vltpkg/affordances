'use client'

import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { useScrolled } from '@/hooks/use-scrolled'

// the reference's motion values as css transitions: in from opacity 0, blur 4px, scale 0.95 and 4px up
export const ScrollToTop = ({ className }: { className?: string }) => {
  const scrolled = useScrolled()

  return (
    <Button
      size="sm"
      variant="outline"
      tabIndex={scrolled ? 0 : -1}
      aria-hidden={!scrolled}
      data-open={scrolled}
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      className={cn(
        // solid fill: outline's dark:bg-input/30 is see-through over article text
        'pointer-events-none fixed top-6 right-0 left-0 z-2000 mx-auto w-fit -translate-y-1 scale-95 bg-background text-xs capitalize opacity-0 shadow-sm blur-[4px] transition-[opacity,filter,scale,translate] duration-250 ease-out active:scale-[1.025] data-[open=true]:pointer-events-auto data-[open=true]:translate-y-0 data-[open=true]:scale-100 data-[open=true]:opacity-100 data-[open=true]:blur-none motion-reduce:transition-none dark:bg-background dark:hover:bg-muted',
        className,
      )}
    >
      <span>back to top</span>
    </Button>
  )
}

'use client'

import { cn } from 'cn'
import { useCopy } from '@afford/ui/hooks/use-copy'
import { Button } from '@/components/ui/button'
import { useTextSelection } from '@/hooks/use-text-selection'

const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length

// the reference animates this with motion (not a dependency here); the same values as css transitions:
// in from opacity 0, blur 4px, scale 0.95 and 4px down, over 250ms ease-out, and back out the same way.
// ponytail: the count doesn't slide (SlidingNumber needs motion); add it with the dependency
export const TextSelection = ({ className }: { className?: string }) => {
  const selection = useTextSelection()
  const { copy } = useCopy()
  const count = wordCount(selection)
  const open = count > 0

  return (
    <div
      data-open={open}
      className={cn(
        // inset-x-0 pins it to the viewport (a bare `fixed` keeps its static left); only the button takes clicks
        'pointer-events-none fixed inset-x-0 bottom-4 z-50 flex translate-y-1 scale-95 flex-row items-center justify-center opacity-0 blur-[4px] transition-[opacity,filter,scale,translate] duration-250 ease-out data-[open=true]:translate-y-0 data-[open=true]:scale-100 data-[open=true]:opacity-100 data-[open=true]:blur-none motion-reduce:transition-none',
        className,
      )}
    >
      <Button
        tabIndex={open ? 0 : -1}
        // pressing a button would otherwise clear the selection before the click lands
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => copy(selection)}
        size="sm"
        variant="outline"
        // solid fill: outline's dark:bg-input/30 is see-through over article text
        className="relative z-2000 bg-background text-xs capitalize shadow-sm transition-transform active:scale-[1.025] in-data-[open=true]:pointer-events-auto dark:bg-background dark:hover:bg-muted"
      >
        <span className="tabular-nums">{String(count).padStart(2, '0')}</span>{' '}
        <span>words selected</span>
      </Button>
    </div>
  )
}

'use client'

import { Button } from '@afford/ui/components/button'
import { useCopy } from '@afford/ui/hooks/use-copy'
import { useTextSelection } from '@/hooks/use-text-selection'

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length

// a copy button that follows a text selection in the article; it stays mounted so it can fade both ways
export const TextSelection = () => {
  const selection = useTextSelection()
  const { copy } = useCopy()
  const count = words(selection)

  return (
    <div
      data-open={count > 0}
      className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex translate-y-1 justify-center opacity-0 transition-[opacity,translate] duration-150 ease-out data-[open=true]:translate-y-0 data-[open=true]:opacity-100 motion-reduce:transition-none"
    >
      <Button
        size="sm"
        variant="outline"
        tabIndex={count ? 0 : -1}
        // pressing a button would otherwise clear the selection before the click lands
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => copy(selection)}
        className="font-pixel pointer-events-auto bg-background text-xs tabular-nums in-data-[open=false]:pointer-events-none dark:bg-background dark:hover:bg-muted"
      >
        Copy {count} {count === 1 ? 'word' : 'words'}
      </Button>
    </div>
  )
}

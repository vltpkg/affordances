'use client'

import { CheckIcon, CopyIcon } from 'lucide-react'
import { useCopy } from '@afford/ui/hooks/use-copy'

// a shell command you can copy in one click; the label keeps its width so nothing shifts
export const CommandCopy = ({ command }: { command: string }) => {
  const { copied, copy } = useCopy(1500)
  return (
    <button
      type="button"
      onClick={() => copy(command)}
      aria-label={`Copy ${command}`}
      className="group inline-flex h-9 items-center gap-3 rounded-md border bg-card px-3 font-mono text-[13px] outline-none transition-colors duration-150 hover:border-foreground/20 focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <span className="text-muted-foreground select-none">$</span>
      {command}
      {copied ? (
        <CheckIcon aria-hidden className="size-3.5 text-muted-foreground" />
      ) : (
        <CopyIcon
          aria-hidden
          className="size-3.5 text-muted-foreground group-hover:text-foreground"
        />
      )}
    </button>
  )
}

'use client'

import { CheckIcon, CopyIcon } from 'lucide-react'
import { cn } from 'cn'
import { Button } from '@affordances/ui/components/button'
import { useCopy } from '@affordances/ui/hooks/use-copy'
import { usePreferredPackageManager } from '@/hooks/use-preferred-package-manager'
import { PackageManagerSelect } from '@/components/package-manager-select'
import type { PackageManager } from '@/lib/package-managers'

// a one-line shell command as a pill built like the code card: the command and its copy button on the
// inner surface, the package manager picker in the shell beside it. `content` holds every package
// manager's highlighted form and CSS shows the reader's (data-pm-only); copy takes the chosen one
export const InitPill = ({
  commands,
  content,
  className,
}: {
  commands: Record<PackageManager, string>
  content: React.ReactNode
  className?: string
}) => {
  const { copied, copy } = useCopy(1500)
  const { preferredPm } = usePreferredPackageManager()
  return (
    <div
      className={cn(
        'flex w-full items-center gap-1 rounded-full bg-card p-1 shadow-lg ring-1 shadow-black/6.5 ring-border-illustration backdrop-blur',
        className,
      )}
    >
      <div className="flex h-10 min-w-0 flex-1 items-center rounded-full border bg-(--color-illustration) pr-1 pl-4">
        <pre className="min-w-0 flex-1 overflow-x-auto font-mono text-[13px] leading-none whitespace-nowrap text-foreground [scrollbar-width:none] max-[420px]:text-xs [&_span]:text-(--shiki-light) dark:[&_span]:text-(--shiki-dark)">
          <span className="text-muted-foreground">$ </span>
          {content}
        </pre>
        <Button
          data-affordances-md="skip"
          variant="ghost"
          size="icon"
          onClick={() => copy(commands[preferredPm])}
          aria-label={copied ? 'Copied' : 'Copy command'}
          className="ml-1 size-8 shrink-0 rounded-full text-muted-foreground"
        >
          {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
        </Button>
      </div>
      <span aria-hidden className="h-5 w-px shrink-0 bg-border" />
      <PackageManagerSelect className="h-8 shrink-0 rounded-full" />
    </div>
  )
}

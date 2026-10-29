'use client'

import { useCopy } from '@afford/ui/hooks/use-copy'
import { usePreferredPackageManager } from '@/hooks/use-preferred-package-manager'
import { PackageManagerSelect, PerPackageManager } from '@/components/package-manager-select'
import type { PackageManager } from '@/lib/package-managers'

// a shell command in the design's curl box: the command, and a copy button that says it worked. given one
// command per package manager, it shows the reader's and gets a picker
export const CopyCommand = ({
  command,
  children,
  label,
}: {
  command: string | Partial<Record<PackageManager, string>>
  children?: React.ReactNode
  label: string
}) => {
  const { copied, copy } = useCopy(1600)
  const { preferredPm } = usePreferredPackageManager()
  const perPm = typeof command !== 'string'
  return (
    <div className="mt-9 box-border flex h-12 max-w-[520px] items-center gap-1.5 rounded-[10px] border border-(--line2) bg-(--bg2) pr-1.5 pl-4">
      <span className="min-w-0 flex-1 overflow-x-auto font-mono text-[13px] leading-none whitespace-nowrap text-(--fg) [scrollbar-width:none]">
        <span className="text-(--fg3)">$ </span>
        {perPm ? <PerPackageManager render={(pm) => command[pm]} /> : children}
      </span>
      {perPm && <PackageManagerSelect className="h-8 px-2" />}
      <button
        type="button"
        onClick={() => copy((perPm ? command[preferredPm] : command) ?? '', { enableToast: false })}
        aria-label={label}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-transparent px-2.5 font-mono text-xs font-medium text-(--fg2) transition-colors duration-150 hover:border-(--line2) hover:text-(--fg)"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden
        >
          <rect x="9" y="9" width="12" height="12" rx="2" />
          <path d="M5 15V5a2 2 0 0 1 2-2h10" />
        </svg>
        <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
      </button>
    </div>
  )
}

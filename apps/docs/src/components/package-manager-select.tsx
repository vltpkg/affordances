'use client'

import { ChevronDownIcon } from 'lucide-react'
import { cn } from 'cn'
import { Button } from '@afford/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@afford/ui/components/dropdown-menu'
import { usePreferredPackageManager } from '@/hooks/use-preferred-package-manager'
import { DEFAULT_PREFERRED_PM, packageManagers, type PackageManager } from '@/lib/package-managers'
import { Vlt } from '@/components/icons/vlt'
import { Npm } from '@/components/icons/npm'
import { Pnpm } from '@/components/icons/pnpm'
import { Yarn } from '@/components/icons/yarn'
import { Bun } from '@/components/icons/bun'
import { Deno } from '@/components/icons/deno'

const icons = { vlt: Vlt, npm: Npm, pnpm: Pnpm, yarn: Yarn, bun: Bun, deno: Deno }

// one element per package manager; CSS shows the one <html data-pm> names (see docs.css), and markdown
// keeps only the default's
export const PerPackageManager = ({
  render,
}: {
  render: (pm: PackageManager) => React.ReactNode
}) =>
  packageManagers.map((pm) => (
    <span
      key={pm}
      data-pm-only={pm}
      data-afford-md={pm === DEFAULT_PREFERRED_PM ? undefined : 'skip'}
      className="contents"
    >
      {render(pm)}
    </span>
  ))

// ported from vlt.io's PackageManagerSelect: the trigger names the current one, the menu picks another,
// and every command on the page follows
export const PackageManagerSelect = ({ className }: { className?: string }) => {
  const { preferredPm, setPreferredPm } = usePreferredPackageManager()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className={cn('group/pm font-mono text-muted-foreground', className)}
          />
        }
      >
        <span className="sr-only">Package manager: </span>
        <PerPackageManager
          render={(pm) => {
            const Icon = icons[pm]
            return (
              <span className="inline-flex items-center gap-1.5">
                <Icon aria-hidden />
                {pm}
              </span>
            )
          }}
        />
        <ChevronDownIcon
          aria-hidden
          className="transition-transform duration-150 ease-out group-data-popup-open/pm:rotate-180 motion-reduce:transition-none"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        <DropdownMenuRadioGroup
          value={preferredPm}
          onValueChange={(pm: PackageManager) => setPreferredPm(pm)}
        >
          {packageManagers.map((pm) => {
            const Icon = icons[pm]
            return (
              <DropdownMenuRadioItem key={pm} value={pm} className="font-mono">
                <Icon aria-hidden />
                {pm}
              </DropdownMenuRadioItem>
            )
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

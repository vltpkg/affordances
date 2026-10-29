'use client'

import { CodeCard } from '@afford/ui/components/code-card'
import { usePreferredPackageManager } from '@/hooks/use-preferred-package-manager'
import { PackageManagerSelect } from '@/components/package-manager-select'
import type { PackageManager } from '@/lib/package-managers'

// a shell card with a package manager picker in its tab bar; `content` holds every package manager's
// highlighted form (CSS shows one), and copy takes the chosen one
export const CommandCard = ({
  commands,
  content,
}: {
  commands: Record<PackageManager, string>
  content: React.ReactNode
}) => {
  const { preferredPm } = usePreferredPackageManager()
  return (
    <CodeCard
      tabs={[{ code: commands[preferredPm], lang: 'bash', content }]}
      toolbar={<PackageManagerSelect />}
      className="w-full"
    />
  )
}

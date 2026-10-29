import { Fragment } from 'react'
import { highlight } from '@affordances/ui/components/code-block'
import { CommandCard } from '@/components/command-card'
import {
  DEFAULT_PREFERRED_PM,
  exec,
  install,
  packageManagers,
  type PackageManager,
} from '@/lib/package-managers'

const forEach = (command: (pm: PackageManager) => string) =>
  Object.fromEntries(packageManagers.map((pm) => [pm, command(pm)])) as Record<
    PackageManager,
    string
  >

// one <code> per package manager in the card's <pre>. the markdown twin drops all but the default's, which
// leaves a plain ```bash fence
const Command = async ({ commands }: { commands: Record<PackageManager, string> }) => {
  'use cache'
  const tabs = await Promise.all(
    packageManagers.map((pm) =>
      highlight(
        { code: commands[pm], lang: 'bash' },
        { dataPmOnly: pm, ...(pm !== DEFAULT_PREFERRED_PM && { dataAffordancesMd: 'skip' }) },
      ),
    ),
  )
  return (
    <CommandCard
      commands={commands}
      content={tabs.map((tab, i) => (
        <Fragment key={packageManagers[i]}>{tab.content}</Fragment>
      ))}
    />
  )
}

// <Run cmd="@affordances/cli init" />: run a package's bin, vlx @affordances/cli init for vlt
export const Run = ({ cmd }: { cmd: string }) => (
  <Command commands={forEach((pm) => exec(pm, cmd))} />
)

// <Install pkgs="@affordances/next zod" dev run="@affordances/cli init" />: add packages, then (optionally) run one
export const Install = ({ pkgs, dev, run }: { pkgs: string; dev?: boolean; run?: string }) => (
  <Command
    commands={forEach((pm) =>
      [install(pm, pkgs.split(/\s+/), dev), ...(run ? [exec(pm, run)] : [])].join('\n'),
    )}
  />
)

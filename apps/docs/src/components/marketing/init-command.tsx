import { Fragment } from 'react'
import { highlight } from '@affordances/ui/components/code-block'
import { InitPill } from '@/components/marketing/init-pill'
import {
  DEFAULT_PREFERRED_PM,
  exec,
  packageManagers,
  type PackageManager,
} from '@/lib/package-managers'

// <InitCommand cmd="@affordances/cli init" />: the hero's one-liner, highlighted once per package manager
// (as components/command.tsx does for the docs). the markdown twin keeps only the default's
export const InitCommand = async ({ cmd, className }: { cmd: string; className?: string }) => {
  'use cache'
  const commands = Object.fromEntries(packageManagers.map((pm) => [pm, exec(pm, cmd)])) as Record<
    PackageManager,
    string
  >
  const forms = await Promise.all(
    packageManagers.map((pm) =>
      highlight(
        { code: commands[pm], lang: 'bash' },
        { dataPmOnly: pm, ...(pm !== DEFAULT_PREFERRED_PM && { dataAffordancesMd: 'skip' }) },
      ),
    ),
  )
  return (
    <InitPill
      commands={commands}
      className={className}
      content={forms.map((f, i) => (
        <Fragment key={packageManagers[i]}>{f.content}</Fragment>
      ))}
    />
  )
}

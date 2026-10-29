'use client'

import { useSyncExternalStore } from 'react'
import { useTheme } from 'next-themes'
import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@affordances/ui/components/dropdown-menu'

const themes = [
  { value: 'system', label: 'System', Icon: MonitorIcon },
  { value: 'dark', label: 'Dark', Icon: MoonIcon },
  { value: 'light', label: 'Light', Icon: SunIcon },
]

// the theme is only known on the client, so render the neutral icon until hydrated
const useMounted = () =>
  useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  )

export const ThemeSwitcher = () => {
  const { theme = 'system', setTheme } = useTheme()
  const mounted = useMounted()
  const current = themes.find((t) => t.value === theme) ?? themes[0]!
  const Icon = mounted ? current.Icon : MonitorIcon

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Theme: ${mounted ? current.label : 'System'}`}
        className="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 data-popup-open:bg-accent data-popup-open:text-foreground"
      >
        <Icon aria-hidden className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="end"
        sideOffset={8}
        className="z-50 w-auto min-w-36 rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg ring-0"
      >
        <DropdownMenuRadioGroup value={theme} onValueChange={(value) => setTheme(String(value))}>
          {themes.map(({ value, label, Icon: ItemIcon }) => (
            <DropdownMenuRadioItem
              key={value}
              value={value}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none focus:bg-accent data-highlighted:bg-accent [&_svg:not([class*='size-'])]:size-4"
            >
              <ItemIcon aria-hidden className="size-4 text-muted-foreground" />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

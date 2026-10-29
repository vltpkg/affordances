# @affordances/react

Affordances for React. `<AffordancesProvider>` loads the current page's graph and registers each available action as a WebMCP tool for browser agents; the tools call the page's Affordances endpoint, so they pass the same checks as any agent. `<Affordance>` marks the controls a person would use for an action, for agents that read the DOM. `<AffordancesDevtools>` from `@affordances/react/dev` outlines them in development.

```bash
vlt install @affordances/react
```

```tsx
'use client'

import { usePathname, useRouter } from 'next/navigation'
import { AffordancesProvider } from '@affordances/react'

export const Agents = ({ children }: { children: React.ReactNode }) => {
  const pathname = usePathname()
  const router = useRouter()
  return (
    <AffordancesProvider path={pathname} onDelta={() => router.refresh()}>
      {children}
    </AffordancesProvider>
  )
}
```

Docs: [https://github.com/affordances/affordances/blob/main/apps/docs/content/react.mdx](https://github.com/affordances/affordances/blob/main/apps/docs/content/react.mdx)

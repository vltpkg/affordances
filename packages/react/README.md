# @afford/react

Afford for React. `<AffordProvider>` loads the current page's graph and registers each available action as a WebMCP tool for browser agents; the tools call the page's Afford endpoint, so they pass the same checks as any agent. `<Affordance>` marks the controls a person would use for an action, for agents that read the DOM. `<AffordDevtools>` from `@afford/react/dev` outlines them in development.

```bash
npm install @afford/react
```

```tsx
'use client'

import { usePathname, useRouter } from 'next/navigation'
import { AffordProvider } from '@afford/react'

export const Agents = ({ children }: { children: React.ReactNode }) => {
  const pathname = usePathname()
  const router = useRouter()
  return (
    <AffordProvider path={pathname} onDelta={() => router.refresh()}>
      {children}
    </AffordProvider>
  )
}
```

Docs: [https://github.com/afford/afford/blob/main/apps/docs/content/react.mdx](https://github.com/afford/afford/blob/main/apps/docs/content/react.mdx)

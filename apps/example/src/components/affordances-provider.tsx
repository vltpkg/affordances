'use client'

import { Affordance, AffordancesProvider } from '@affordances/react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { createContext, Suspense, use, useCallback, useEffect, useState } from 'react'
import { Button } from '@affordances/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@affordances/ui/components/dialog'

// under cacheComponents these hooks can suspend, so only this empty child reads them and the shell stays static
const RouteSync = ({ onChange }: { onChange: (path: string) => void }) => {
  const pathname = usePathname()
  const search = useSearchParams().toString()
  useEffect(
    () => onChange(search ? `${pathname}?${search}` : pathname),
    [pathname, search, onChange],
  )
  return null
}

const PathContext = createContext('/')
// the page's path and query, as the agent view requests it
export const usePagePath = () => use(PathContext)

export const Affordances = ({ children }: { children: React.ReactNode }) => {
  const router = useRouter()
  // the provider renders no markup, so reading location on the client can't mismatch hydration
  const [path, setPath] = useState(() =>
    typeof window === 'undefined' ? '/' : location.pathname + location.search,
  )
  const [request, setRequest] = useState<{ message: string; resolve: (ok: boolean) => void }>()
  const [open, setOpen] = useState(false)

  const confirm = useCallback(
    (message: string) =>
      new Promise<boolean>((resolve) => {
        setRequest({ message, resolve })
        setOpen(true)
      }),
    [],
  )
  // the request outlives `open`, so the text stays put while the dialog animates out
  const settle = (ok: boolean) => {
    request?.resolve(ok)
    setOpen(false)
  }

  return (
    <AffordancesProvider
      path={path}
      confirm={confirm}
      onDelta={(delta) => {
        // drops the client cache too, so a prefetched page (orders, the cart count) isn't shown stale
        router.refresh()
        if (delta.redirect) router.push(delta.redirect)
      }}
    >
      <Suspense>
        <RouteSync onChange={setPath} />
      </Suspense>
      <PathContext value={path}>{children}</PathContext>
      <Dialog open={open} onOpenChange={(next) => !next && settle(false)}>
        <DialogContent showCloseButton={false} className="gap-6 p-5 sm:max-w-sm">
          <DialogHeader className="gap-2">
            <DialogTitle className="text-base font-semibold tracking-tight">
              Place this order?
            </DialogTitle>
            <DialogDescription className="text-sm text-pretty text-foreground">
              {request?.message}
            </DialogDescription>
            <p className="text-sm text-muted-foreground">
              An agent on this page asked to do this. Nothing happens unless you approve.
            </p>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              size="lg"
              className="h-9 text-sm"
              onClick={() => settle(false)}
            >
              Cancel
            </Button>
            <Affordance name="placeOrder">
              <Button size="lg" className="h-9 text-sm" onClick={() => settle(true)}>
                Place order
              </Button>
            </Affordance>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AffordancesProvider>
  )
}

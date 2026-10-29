import Link from 'next/link'
import { Suspense } from 'react'
import { Wordmark } from '@afford/ui/components/wordmark'
import { getSessionId } from '@/lib/session'
import { cartCount } from '@/lib/store'

const CartCount = async () => {
  const count = cartCount(await getSessionId())
  return count ? count : null
}

const link =
  'rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors duration-150 ease-out outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30'

export const SiteHeader = () => (
  <header className="sticky top-0 z-10 border-b bg-background">
    <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
      <Link
        href="/"
        className="flex items-baseline gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
      >
        <Wordmark />
        <span className="font-medium">Supply</span>
      </Link>
      <nav className="-mr-2 flex items-center gap-1">
        {/* agent-view toggle */}
        <Link href="/account/orders" className={link}>
          Orders
        </Link>
        <Link href="/cart" className={link}>
          Cart
          <span className="ml-1 inline-block min-w-[1ch] font-mono text-foreground tabular-nums">
            <Suspense>
              <CartCount />
            </Suspense>
          </span>
        </Link>
      </nav>
    </div>
  </header>
)

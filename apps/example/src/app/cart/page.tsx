import { MinusIcon, PlusIcon } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { buttonVariants } from '@afford/ui/components/button'
import { cn } from 'cn'
import { ProductArt } from '@/components/product-art'
import { SubmitButton } from '@/components/submit-button'
import { Totals } from '@/components/totals'
import { getSessionId } from '@/lib/session'
import { removeItem, updateQuantity } from './actions'
import { loadCart } from './state'

export const metadata: Metadata = { title: 'Cart' }

const Cart = async () => {
  const { cart } = loadCart(await getSessionId())
  if (!cart.count)
    return (
      <p className="mt-2 text-muted-foreground">
        Your cart is empty.{' '}
        <Link href="/" className="text-foreground underline underline-offset-4">
          Browse the index
        </Link>
      </p>
    )

  return (
    <div className="mt-8 grid gap-10 md:grid-cols-[minmax(0,1fr)_16rem] md:gap-12">
      <ul className="border-t">
        {cart.items.map((item) => (
          <li
            key={item.sku}
            className="grid grid-cols-[3.5rem_minmax(0,1fr)_auto] gap-4 border-b py-4"
          >
            <ProductArt slug={item.href.split('/').at(-1)!} />
            <div className="min-w-0">
              <Link href={item.href} className="font-medium underline-offset-4 hover:underline">
                {item.name}
              </Link>
              <p className="text-sm text-muted-foreground">
                {item.variant && `${item.variant}, `}
                <span className="font-mono text-xs">{item.sku}</span>
              </p>
              <div className="mt-3 flex items-center gap-2">
                <form action={updateQuantity} className="flex h-7 items-center rounded-md border">
                  <input type="hidden" name="sku" value={item.sku} />
                  <SubmitButton
                    name="quantity"
                    value={item.quantity - 1}
                    variant="ghost"
                    size="icon"
                    disabled={item.quantity <= 1}
                    aria-label={`One fewer ${item.name}`}
                  >
                    <MinusIcon />
                  </SubmitButton>
                  <output className="w-6 text-center font-mono text-xs tabular-nums">
                    {item.quantity}
                  </output>
                  <SubmitButton
                    name="quantity"
                    value={item.quantity + 1}
                    variant="ghost"
                    size="icon"
                    disabled={item.quantity >= Math.min(item.stock, 10)}
                    aria-label={`One more ${item.name}`}
                  >
                    <PlusIcon />
                  </SubmitButton>
                </form>
                <form action={removeItem}>
                  <input type="hidden" name="sku" value={item.sku} />
                  <SubmitButton variant="ghost" className="text-muted-foreground">
                    Remove
                  </SubmitButton>
                </form>
              </div>
            </div>
            <p className="font-mono text-sm tabular-nums">{item.total}</p>
          </li>
        ))}
      </ul>
      <aside className="self-start md:sticky md:top-24">
        <Totals count={cart.count} total={cart.subtotal} />
        <Link
          href="/checkout"
          className={cn(buttonVariants({ size: 'lg' }), 'mt-6 h-9 w-full text-sm')}
        >
          Check out
        </Link>
      </aside>
    </div>
  )
}

const Page = () => (
  <>
    <h1 className="text-2xl font-semibold tracking-tight">Cart</h1>
    <Suspense>
      <Cart />
    </Suspense>
  </>
)

export default Page

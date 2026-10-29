import { MinusIcon, PlusIcon } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { Affordance } from '@affordances/react'
import { buttonVariants } from '@affordances/ui/components/button'
import { cn } from 'cn'
import { ProductArt } from '@/components/product-art'
import { ProductList } from '@/components/product-list'
import { SubmitButton } from '@/components/submit-button'
import { Totals } from '@/components/totals'
import { getSessionId } from '@/lib/session'
import { listProducts } from '@/lib/store'
import { listing } from '../state'
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
                <Affordance action={updateQuantity} input={{ sku: item.sku }}>
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
                </Affordance>
                <Affordance action={removeItem} input={{ sku: item.sku }}>
                  <form action={removeItem}>
                    <input type="hidden" name="sku" value={item.sku} />
                    <SubmitButton variant="ghost" className="text-muted-foreground">
                      Remove
                    </SubmitButton>
                  </form>
                </Affordance>
              </div>
            </div>
            <p className="font-mono text-sm tabular-nums">{item.total}</p>
          </li>
        ))}
      </ul>
      <aside aria-labelledby="summary" className="self-start md:sticky md:top-24">
        <h2 id="summary" className="text-sm font-medium">
          Order summary
        </h2>
        <div className="mt-2">
          <Totals count={cart.count} total={cart.subtotal} />
        </div>
        <Link
          href="/checkout"
          className={cn(buttonVariants({ size: 'lg' }), 'mt-6 h-9 w-full text-sm')}
        >
          Check out
        </Link>
        <ul className="mt-6 space-y-1.5 text-xs text-muted-foreground">
          <li>Free shipping on every order</li>
          <li>Free returns within 30 days</li>
          <li>Taxes included where they apply</li>
        </ul>
      </aside>
      <Upsell inCart={cart.items.map((item) => item.href)} />
    </div>
  )
}

// what isn't in the cart yet and can still be bought
const Upsell = ({ inCart }: { inCart: string[] }) => {
  const picks = listProducts()
    .map(listing)
    .filter((p) => p.inStock && !inCart.includes(p.href))
    .slice(0, 4)
  if (!picks.length) return null
  return (
    <section aria-labelledby="upsell" className="mt-10 border-t pt-10 md:col-span-2">
      <h2 id="upsell" className="text-lg font-semibold tracking-tight">
        Pairs well with
      </h2>
      <ProductList products={picks} className="mt-6" />
    </section>
  )
}

const Page = () => (
  <>
    <div className="flex items-baseline justify-between gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Cart</h1>
      <Link
        href="/"
        className="rounded-sm text-sm text-muted-foreground underline-offset-4 outline-none transition-colors duration-150 ease-out hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30"
      >
        Continue shopping
      </Link>
    </div>
    <Suspense>
      <Cart />
    </Suspense>
  </>
)

export default Page

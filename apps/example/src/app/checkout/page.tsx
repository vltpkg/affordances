import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { Affordance } from '@affordances/react'
import { SubmitButton } from '@/components/submit-button'
import { Totals } from '@/components/totals'
import { getSessionId } from '@/lib/session'
import { placeOrder } from './actions'
import { loadCheckout } from './state'

export const metadata: Metadata = { title: 'Checkout' }

const reassurance = [
  ['Delivery', 'Free standard shipping. Dispatched within 2 business days, arriving in 3–5.'],
  ['Returns', 'Free within 30 days of delivery for unused items.'],
  ['Payment', 'Encrypted and processed securely. We never store card details.'],
  ['Questions', 'hello@affordsupply.example, answered within a day.'],
]

const Checkout = async () => {
  const { cart } = loadCheckout(await getSessionId())
  if (!cart.count)
    return (
      <p className="mt-2 text-muted-foreground">
        Nothing to check out yet.{' '}
        <Link href="/" className="text-foreground underline underline-offset-4">
          Browse the index
        </Link>
      </p>
    )
  const short = cart.items.find((i) => i.quantity > i.stock)

  return (
    <div className="mt-8 grid gap-10 md:grid-cols-[minmax(0,1fr)_16rem] md:gap-12">
      <div>
        <h2 id="order-summary" className="text-sm font-medium">
          Order summary
        </h2>
        <ul aria-labelledby="order-summary" className="mt-3 border-t text-sm">
          {cart.items.map((item) => (
            <li key={item.sku} className="flex items-baseline justify-between gap-4 border-b py-3">
              <div className="min-w-0">
                <p className="font-medium">{item.name}</p>
                <p className="text-muted-foreground">
                  {item.variant && `${item.variant}, `}
                  <span className="font-mono text-xs tabular-nums">
                    {item.quantity} × {item.price}
                  </span>
                </p>
              </div>
              <p className="font-mono tabular-nums">{item.total}</p>
            </li>
          ))}
        </ul>
        <div className="mt-4">
          <Totals count={cart.count} total={cart.subtotal} />
        </div>
        <Affordance action={placeOrder}>
          <form action={placeOrder} className="mt-8">
            <SubmitButton size="lg" className="h-9 w-full text-sm" disabled={!!short}>
              Place order
            </SubmitButton>
          </form>
        </Affordance>
        <p className="mt-3 text-sm text-muted-foreground">
          {short
            ? `Only ${short.stock} left of ${short.name}. Change the quantity in your cart.`
            : 'This is a demo store. Placing an order reserves the stock, and nothing ships.'}
        </p>
        <Link
          href="/cart"
          className="mt-6 inline-block rounded-sm text-sm text-muted-foreground outline-none transition-colors duration-150 ease-out hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30"
        >
          Return to cart
        </Link>
      </div>
      <aside aria-label="Delivery and returns" className="self-start text-sm">
        <dl className="space-y-4">
          {reassurance.map(([term, detail]) => (
            <div key={term}>
              <dt className="font-medium">{term}</dt>
              <dd className="mt-0.5 text-pretty text-muted-foreground">{detail}</dd>
            </div>
          ))}
        </dl>
      </aside>
    </div>
  )
}

const Page = () => (
  <>
    <h1 className="text-2xl font-semibold tracking-tight">Checkout</h1>
    <Suspense>
      <Checkout />
    </Suspense>
  </>
)

export default Page

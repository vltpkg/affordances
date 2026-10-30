import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { getSessionId } from '@/lib/session'
import { loadOrders } from './state'

export const metadata: Metadata = { title: 'Orders' }

const date = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' })

const Orders = async () => {
  const { orders } = loadOrders(await getSessionId())
  if (!orders.length)
    return (
      <p className="mt-2 text-muted-foreground">
        No orders yet.{' '}
        <Link href="/" className="text-foreground underline underline-offset-4">
          Browse the index
        </Link>
      </p>
    )

  return (
    <ol className="mt-8 border-t">
      {orders.map((order) => (
        <li
          key={order.id}
          className="grid gap-x-6 gap-y-2 border-b py-5 text-sm sm:grid-cols-[10rem_minmax(0,1fr)_auto]"
        >
          <div className="flex justify-between gap-4 sm:block">
            <p className="font-mono">{order.id}</p>
            <time dateTime={order.placedAt} className="text-muted-foreground">
              {date.format(new Date(order.placedAt))}
            </time>
          </div>
          <ul className="text-muted-foreground">
            {order.items.map((item) => (
              <li key={`${item.name}-${item.variant}`}>
                <span className="font-mono text-xs tabular-nums">{item.quantity} ×</span>{' '}
                <span className="text-foreground">{item.name}</span>
                {item.variant && `, ${item.variant}`}
              </li>
            ))}
          </ul>
          <p className="font-mono tabular-nums sm:text-right">{order.total}</p>
        </li>
      ))}
    </ol>
  )
}

const Page = () => (
  <>
    <h1 className="text-2xl font-semibold tracking-tight">Orders</h1>
    <Suspense>
      <Orders />
    </Suspense>
  </>
)

export default Page

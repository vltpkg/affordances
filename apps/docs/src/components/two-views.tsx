'use client'

import { useState } from 'react'
import { AppWindowIcon, BracesIcon, ShoppingBagIcon } from 'lucide-react'
import { cn } from 'cn'
import type { Delta, Graph } from '@afford/protocol'
import fixture from '@afford/protocol/fixtures/valid/graph.product.json'
import addToCart from '@afford/protocol/fixtures/valid/delta.add-to-cart.json'
import { JsonView } from '@afford/ui/components/json-view'
import { Button } from '@/components/ui/button'

type Money = { amount: number; currency: string }
type Variant = { sku: string; color: string; size: string; stock: number }
type Product = { slug: string; name: string; price: Money; variants: Variant[] }
type Cart = { count: number; subtotal: Money }

const initial = fixture as Graph
const product = initial.entities.product as Product
const firstCart = initial.entities.cart as Cart
const notify = initial.actions.find((action) => action.name === 'notifyWhenInStock')

const money = ({ amount, currency }: Money) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount / 100)

// what the handler would answer: the first add is the protocol fixture verbatim, later ones follow its shape
const deltaFor = (cart: Cart, variant: Variant): Delta =>
  cart.count === firstCart.count
    ? (addToCart as Delta)
    : {
        ok: true,
        changed: {
          cart: {
            count: cart.count + 1,
            subtotal: { ...cart.subtotal, amount: cart.subtotal.amount + product.price.amount },
          },
        },
        message: `Added ${product.name} (${variant.size}) to your cart`,
      }

// the demo store's own drawing (apps/example's product-art.tsx): a 96 × 96 grid, 1.25px strokes at any size
const Tee = () => (
  <svg
    viewBox="0 0 96 96"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.25"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
    className="size-full [&_*]:[vector-effect:non-scaling-stroke]"
  >
    <path d="M38 22 24 27 15 41l10 5 4-5v35h38V41l4 5 10-5-9-14-14-5c-2 5-6 7-10 7s-8-2-10-7Z" />
    <path d="M41 23.5c1.5 3.5 4 5 7 5s5.5-1.5 7-5" />
    <path d="M29 72h38" />
  </svg>
)

// the code card's dress, for cards that aren't code: one tab flowing into an editor panel inside a lifted,
// ringed frame, and an optional status line under the panel in the tab bar's type
const Frame = ({
  icon,
  title,
  type,
  footer,
  className,
  children,
}: {
  icon: React.ReactNode
  title: string
  // the representation this view is, shown muted after the title
  type?: string
  footer?: React.ReactNode
  className?: string
  children: React.ReactNode
}) => (
  <figure
    className={cn(
      'relative flex flex-col overflow-hidden rounded-2xl border border-transparent bg-card px-1 shadow-lg ring-1 shadow-black/6.5 ring-border-illustration backdrop-blur [--code-editor-background:var(--color-illustration)]',
      !footer && 'pb-1',
      className,
    )}
  >
    <figcaption className="relative h-11 w-fit shrink-0">
      <span
        aria-hidden
        className="absolute inset-x-0 top-1 -bottom-px rounded-t-xl border-x border-t bg-(--code-editor-background)"
      >
        {/* the tab lines up with the panel's edge, so its left side runs straight down */}
        <span className="absolute -bottom-4 -left-px size-4 border-l bg-(--code-editor-background)" />
        <span className="absolute -right-4 bottom-0 size-4 bg-(--code-editor-background)">
          <span className="block size-full rounded-bl-xl border-b border-l bg-card" />
        </span>
      </span>
      <span className="relative mt-1 flex h-10 items-center gap-1.5 rounded-lg px-3 font-mono text-xs whitespace-nowrap text-foreground/75 [&_svg]:size-3">
        {icon}
        {title}
        {type && <span className="text-muted-foreground">· {type}</span>}
      </span>
    </figcaption>
    <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border bg-(--code-editor-background)">
      {children}
    </div>
    {footer && (
      <div className="flex h-9 shrink-0 items-center gap-2 px-3 font-mono text-xs text-muted-foreground">
        {footer}
      </div>
    )}
  </figure>
)

// one url, two readers: the product page a person sees and the graph an agent reads, from the same state.
// adding to the cart in one updates the other, the way a delta would
export const TwoViews = () => {
  const [graph, setGraph] = useState(initial)
  const [delta, setDelta] = useState<Delta | null>(null)
  const [calls, setCalls] = useState(0)
  const [sku, setSku] = useState(product.variants[0]!.sku)

  const cart = graph.entities.cart as Cart
  const variant = product.variants.find((v) => v.sku === sku)!
  const inStock = variant.stock > 0

  const add = () => {
    const next = deltaFor(cart, variant)
    setDelta(next)
    setCalls(calls + 1)
    setGraph({ ...graph, entities: { ...graph.entities, ...next.changed } })
  }

  return (
    <div className="@container">
      {/* one url, asked for twice: the bar forks into the two representations it serves */}
      <div className="flex justify-center">
        <p className="rounded-xl bg-card px-4 py-2 font-mono text-xs text-foreground/75 shadow-lg ring-1 shadow-black/6.5 ring-border-illustration">
          <span className="text-muted-foreground">GET</span> {graph.page}
        </p>
      </div>
      <div aria-hidden className="relative h-6 @max-3xl:hidden">
        <span className="absolute top-0 left-1/2 h-3 border-l" />
        <span className="absolute top-3 right-1/4 left-1/4 h-3 rounded-t-lg border-x border-t" />
      </div>
      <div className="grid gap-4 @max-3xl:mt-4 @3xl:grid-cols-2">
        <Frame
          icon={<AppWindowIcon aria-hidden className="text-muted-foreground" />}
          title="Human"
          type="text/html"
        >
          <div className="flex h-full flex-col">
            <div className="flex h-11 shrink-0 items-center justify-between border-b px-4 text-xs">
              <span className="font-semibold tracking-tight">Afford Supply</span>
              <span className="flex items-center gap-1.5 text-muted-foreground tabular-nums">
                <ShoppingBagIcon aria-hidden className="size-3.5" />
                <span
                  key={cart.count}
                  className="text-foreground duration-200 animate-in fade-in-0 zoom-in-90 motion-reduce:animate-none"
                >
                  {cart.count}
                </span>
              </span>
            </div>
            <div className="flex flex-1 flex-col gap-5 p-4">
              {/* the store's product plate: the drawing on bg-muted, as on its product page */}
              <div className="h-44 shrink-0 rounded-md bg-muted p-2 text-foreground">
                <Tee />
              </div>
              <div>
                <p className="text-xs text-muted-foreground capitalize">{variant.color}</p>
                <div className="mt-1 flex items-baseline justify-between gap-4">
                  <h3 className="text-base font-semibold tracking-tight whitespace-nowrap">
                    {product.name}
                  </h3>
                  <p className="tabular-nums">{money(product.price)}</p>
                </div>
                <fieldset className="mt-4">
                  <legend className="text-xs text-muted-foreground">Size</legend>
                  <div className="mt-2 flex gap-2">
                    {product.variants.map((v) => (
                      <button
                        key={v.sku}
                        type="button"
                        aria-pressed={v.sku === sku}
                        aria-label={v.stock ? `Size ${v.size}` : `Size ${v.size}, sold out`}
                        onClick={() => setSku(v.sku)}
                        className={cn(
                          'h-9 min-w-12 rounded-lg border px-3 text-sm transition-colors duration-150 outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                          v.sku === sku ? 'border-foreground' : 'hover:border-foreground/30',
                          v.stock === 0 && 'border-dashed text-muted-foreground',
                        )}
                      >
                        {v.size}
                      </button>
                    ))}
                  </div>
                </fieldset>
                {inStock ? (
                  <Button
                    size="lg"
                    className="mt-4 w-full"
                    onClick={add}
                    data-afford-action="addToCart"
                  >
                    Add to cart
                  </Button>
                ) : (
                  <Button
                    size="lg"
                    variant="outline"
                    className="mt-4 w-full"
                    disabled
                    data-afford-action={notify?.name}
                  >
                    Notify me
                  </Button>
                )}
                <p
                  aria-live="polite"
                  className="mt-3 min-h-10 text-xs leading-5 text-muted-foreground"
                >
                  {inStock
                    ? (delta?.message ??
                      `${cart.count} ${cart.count === 1 ? 'item' : 'items'} in your cart, ${money(cart.subtotal)}`)
                    : notify?.reason}
                </p>
              </div>
            </div>
          </div>
        </Frame>

        <Frame
          icon={<BracesIcon aria-hidden className="text-amber-600" />}
          title="Agent"
          type="application/vnd.afford+json"
          // side by side, the human card sets the height; stacked, the graph gets a window of its own
          className="@max-3xl:h-[28rem]"
          footer={
            delta ? (
              <span
                key={calls}
                className="truncate duration-200 animate-in fade-in-0 motion-reduce:animate-none"
              >
                POST addToCart · 200
              </span>
            ) : (
              <span
                className="truncate"
                title={`GET ${graph.page} · Accept: application/vnd.afford+json`}
              >
                GET {graph.page} · Accept: application/vnd.afford+json
              </span>
            )
          }
        >
          {/* out of flow, so the graph scrolls inside the card instead of setting the row's height */}
          <div className="absolute inset-0 overflow-y-auto p-4 pl-7">
            {delta && (
              // remounts per call, so the tint plays each time a delta lands
              <div
                key={calls}
                className="-mx-3 -mt-1 mb-4 rounded-lg px-3 pt-1 pb-1 animate-json-changed motion-reduce:[animation-timing-function:steps(1,end)]"
              >
                <JsonView value={delta} />
              </div>
            )}
            <JsonView value={graph} highlight={['entities.cart']} />
          </div>
        </Frame>
      </div>
    </div>
  )
}

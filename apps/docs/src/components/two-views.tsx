'use client'

import { useId, useRef, useState } from 'react'
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
type View = 'human' | 'agent'

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

// the concave corner where the active tab meets the panel's top edge (as in the code card)
const Corner = ({ side }: { side: 'left' | 'right' }) => (
  <span
    className={cn(
      'absolute bottom-0 size-4 bg-(--code-editor-background)',
      side === 'left' ? '-left-4' : '-right-4',
    )}
  >
    <span
      className={cn(
        'block size-full border-b bg-card',
        side === 'left' ? 'rounded-br-xl border-r' : 'rounded-bl-xl border-l',
      )}
    />
  </span>
)

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

const Label = ({ children, detail }: { children: React.ReactNode; detail: string }) => (
  <p className="mb-3 flex items-baseline gap-3 text-xs">
    <span className="font-pixel text-foreground">{children}</span>
    <span className="truncate font-mono text-muted-foreground">{detail}</span>
  </p>
)

// one url, two readers: the product page a person sees, and the graph an agent reads, from the same state.
// dressed as the code card: the active tab flows into an editor panel inside a lifted, ringed frame
export const TwoViews = () => {
  const id = useId()
  const tabs = useRef<(HTMLButtonElement | null)[]>([])
  const [view, setView] = useState<View>('human')
  const [graph, setGraph] = useState(initial)
  const [delta, setDelta] = useState<Delta | null>(null)
  const [calls, setCalls] = useState(0)
  const [seen, setSeen] = useState(0)
  const [sku, setSku] = useState(product.variants[0]!.sku)

  const cart = graph.entities.cart as Cart
  const variant = product.variants.find((v) => v.sku === sku)!
  const inStock = variant.stock > 0

  const show = (next: View) => {
    setView(next)
    if (next === 'agent') setSeen(calls)
  }

  const add = () => {
    const next = deltaFor(cart, variant)
    setDelta(next)
    setCalls(calls + 1)
    setGraph({ ...graph, entities: { ...graph.entities, ...next.changed } })
  }

  const views = [
    { value: 'human' as const, label: 'Human', Icon: AppWindowIcon, icon: 'text-muted-foreground' },
    { value: 'agent' as const, label: 'Agent', Icon: BracesIcon, icon: 'text-amber-600' },
  ]

  return (
    <figure className="relative overflow-hidden rounded-2xl border border-transparent bg-card px-1 pb-1 shadow-lg ring-1 shadow-black/6.5 ring-border-illustration backdrop-blur [--code-editor-background:var(--color-illustration)]">
      <div className="flex h-11 items-center justify-between">
        <div role="tablist" aria-label="Two views of one URL" className="flex h-11">
          {views.map(({ value, label, Icon, icon }, i) => {
            const active = view === value
            return (
              <button
                key={value}
                ref={(el) => {
                  tabs.current[i] = el
                }}
                type="button"
                role="tab"
                id={`${id}-${value}-tab`}
                aria-selected={active}
                aria-controls={`${id}-${value}`}
                tabIndex={active ? 0 : -1}
                data-state={active ? 'active' : 'inactive'}
                onClick={() => show(value)}
                // two tabs, so either arrow moves to the other one
                onKeyDown={(e) => {
                  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
                  const next = views[1 - i]!.value
                  show(next)
                  tabs.current[1 - i]?.focus()
                }}
                className="group relative h-11 shrink-0 outline-none"
              >
                <span
                  aria-hidden
                  className="absolute inset-x-0 top-1 -bottom-px hidden rounded-t-xl border-x border-t bg-(--code-editor-background) group-data-[state=active]:block"
                >
                  {i === 0 ? (
                    <span className="absolute -bottom-4 -left-px size-4 border-l bg-(--code-editor-background)" />
                  ) : (
                    <Corner side="left" />
                  )}
                  <Corner side="right" />
                </span>
                <span className="relative mt-1 flex h-10 items-center gap-1.5 rounded-lg px-3 font-mono text-xs whitespace-nowrap text-muted-foreground group-focus-visible:ring-2 group-focus-visible:ring-ring/50 group-data-[state=active]:text-foreground/75 group-data-[state=inactive]:group-hover:bg-foreground/5 group-data-[state=inactive]:group-hover:text-foreground">
                  <Icon aria-hidden className={cn('size-3', icon)} />
                  {label}
                  {value === 'agent' && calls > seen && (
                    <span className="relative flex size-1.5">
                      <span className="absolute inset-0 animate-ping rounded-full bg-progress opacity-60 motion-reduce:hidden" />
                      <span className="relative size-1.5 rounded-full bg-progress" />
                      <span className="sr-only">, changed</span>
                    </span>
                  )}
                </span>
              </button>
            )
          })}
        </div>
        <span className="mr-3 hidden truncate font-mono text-xs text-muted-foreground sm:block">
          {view === 'human' ? 'GET' : 'Accept: application/vnd.afford+json'} {graph.page}
        </span>
      </div>

      <div className="h-[32rem] overflow-hidden rounded-xl border bg-(--code-editor-background) sm:h-[26rem]">
        {/* both views stay mounted, so state survives the switch */}
        <div
          role="tabpanel"
          id={`${id}-human`}
          aria-labelledby={`${id}-human-tab`}
          hidden={view !== 'human'}
          className="flex h-full flex-col"
        >
          <div className="flex h-11 shrink-0 items-center justify-between border-b px-4 text-xs">
            <span className="font-semibold tracking-tight">Afford Supply</span>
            <span className="flex items-center gap-1.5 text-muted-foreground tabular-nums">
              <ShoppingBagIcon aria-hidden className="size-3.5" />
              <span
                key={cart.count}
                className="text-foreground animate-in fade-in-0 zoom-in-90 duration-200 motion-reduce:animate-none"
              >
                {cart.count}
              </span>
            </span>
          </div>
          <div className="grid min-h-0 flex-1 gap-5 p-4 sm:grid-cols-2 sm:grid-rows-[minmax(0,1fr)] sm:gap-8 sm:p-6">
            {/* the store's product plate: the drawing on bg-muted, as on its product page */}
            <div className="min-h-0 rounded-md bg-muted p-2 text-foreground max-sm:h-40">
              <Tee />
            </div>
            <div className="flex flex-col justify-center">
              <p className="text-xs text-muted-foreground capitalize">{variant.color}</p>
              <div className="mt-1 flex items-baseline justify-between gap-4">
                <h3 className="text-xl font-semibold tracking-tight">{product.name}</h3>
                <p className="tabular-nums">{money(product.price)}</p>
              </div>
              <fieldset className="mt-5">
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
                  className="mt-5 w-full"
                  onClick={add}
                  data-afford-action="addToCart"
                >
                  Add to cart
                </Button>
              ) : (
                <Button
                  size="lg"
                  variant="outline"
                  className="mt-5 w-full"
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

        <div
          role="tabpanel"
          id={`${id}-agent`}
          aria-labelledby={`${id}-agent-tab`}
          hidden={view !== 'agent'}
          className="h-full overflow-y-auto p-5 pl-8 sm:p-6 sm:pl-9"
        >
          {delta ? (
            // remounts per delta shown, so the tint plays when the agent view opens, not while it's hidden
            <div
              key={`${calls}-${view}`}
              className="-mx-3 -mt-2 mb-4 rounded-lg px-3 pt-2 pb-1 animate-json-changed motion-reduce:[animation-timing-function:steps(1,end)]"
            >
              <Label detail="POST addToCart">Delta</Label>
              <JsonView value={delta} />
            </div>
          ) : (
            <p className="mb-6 text-xs text-muted-foreground">
              No calls yet. Add the tee to the cart in the human view, and the delta lands here.
            </p>
          )}
          <Label detail="GET, the same url">Graph</Label>
          <JsonView value={graph} highlight={['entities.cart']} />
        </div>
      </div>
    </figure>
  )
}

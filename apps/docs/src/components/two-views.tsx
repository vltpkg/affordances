'use client'

import { useEffect, useId, useRef, useState } from 'react'
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

// the concave corner where the active tab meets the panel's top edge, as in the code card
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

// a tab's face: the code card's, so the active one flows into the panel (`data-state` on the parent group)
const TabFace = ({ first, children }: { first: boolean; children: React.ReactNode }) => (
  <>
    <span
      aria-hidden
      className="absolute inset-x-0 top-1 -bottom-px hidden rounded-t-xl border-x border-t bg-(--code-editor-background) group-data-[state=active]:block"
    >
      {/* the first tab lines up with the panel's edge, so that side runs straight down over its corner */}
      {first ? (
        <span className="absolute -bottom-4 -left-px size-4 border-l bg-(--code-editor-background)" />
      ) : (
        <Corner side="left" />
      )}
      <Corner side="right" />
    </span>
    <span className="relative mt-1 flex h-10 items-center gap-1.5 rounded-lg px-3 font-mono text-xs whitespace-nowrap text-muted-foreground group-focus-visible:ring-2 group-focus-visible:ring-ring/50 group-data-[state=active]:text-foreground/75 group-data-[state=inactive]:group-hover:bg-foreground/5 group-data-[state=inactive]:group-hover:text-foreground [&_svg]:size-3">
      {children}
    </span>
  </>
)

// the code card's dress, for cards that aren't code: a tab bar over an editor panel inside a lifted, ringed
// frame, and an optional status line under the panel in the tab bar's type
const Frame = ({
  bar,
  footer,
  className,
  children,
}: {
  bar: React.ReactNode
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
    {/* z-10: the active tab's 1px overlap and corner pieces paint over the panel's top border */}
    <div className="relative z-10 flex h-11 shrink-0 items-center">{bar}</div>
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
  const [tab, setTab] = useState<'graph' | 'delta'>('graph')
  const id = useId()
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const graphPanel = useRef<HTMLDivElement>(null)
  const graphSeen = useRef(0)

  // back on the graph after a call, bring `cart` into view so its tint is seen, not scrolled past
  useEffect(() => {
    if (tab !== 'graph' || graphSeen.current === calls) return
    graphSeen.current = calls
    const panel = graphPanel.current
    const key = [...(panel?.querySelectorAll('.text-json-key') ?? [])].find(
      (el) => el.textContent === '"cart"',
    )
    if (!panel || !key) return
    const top =
      key.getBoundingClientRect().top - panel.getBoundingClientRect().top + panel.scrollTop
    panel.scrollTo({ top: top - 48 })
  }, [tab, calls])
  // the delta tab joins the bar with the first call and is reused after that
  const tabs = [
    { value: 'graph' as const, label: 'Graph' },
    ...(delta ? [{ value: 'delta' as const, label: 'Delta · POST addToCart' }] : []),
  ]
  const [sku, setSku] = useState(product.variants[0]!.sku)

  const cart = graph.entities.cart as Cart
  const variant = product.variants.find((v) => v.sku === sku)!
  const inStock = variant.stock > 0

  const add = () => {
    const next = deltaFor(cart, variant)
    setDelta(next)
    setCalls(calls + 1)
    setTab('delta')
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
          bar={
            <div data-state="active" className="group relative h-11 w-fit">
              <TabFace first>
                <AppWindowIcon aria-hidden className="text-muted-foreground" />
                Human<span className="text-muted-foreground">· text/html</span>
              </TabFace>
            </div>
          }
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
          // side by side, the human card sets the height; stacked, the graph gets a window of its own
          className="@max-3xl:h-[28rem]"
          bar={
            <>
              <div role="tablist" aria-label="Agent view" className="flex h-11 shrink-0">
                {tabs.map(({ value, label }, i) => (
                  <button
                    key={value}
                    ref={(el) => {
                      tabRefs.current[i] = el
                    }}
                    type="button"
                    role="tab"
                    id={`${id}-${value}-tab`}
                    aria-selected={tab === value}
                    aria-controls={`${id}-${value}`}
                    tabIndex={tab === value ? 0 : -1}
                    data-state={tab === value ? 'active' : 'inactive'}
                    onClick={() => setTab(value)}
                    onKeyDown={(e) => {
                      const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key]
                      if (!step) return
                      const next = (i + step + tabs.length) % tabs.length
                      setTab(tabs[next]!.value)
                      tabRefs.current[next]?.focus()
                    }}
                    className={cn(
                      'group relative h-11 shrink-0 outline-none',
                      // the delta tab slides in from its slot's left edge as it widens
                      value === 'delta' &&
                        'transition-[opacity,translate] duration-200 ease-out starting:-translate-x-2 starting:opacity-0 motion-reduce:transition-none',
                    )}
                  >
                    <TabFace first={i === 0}>
                      <BracesIcon aria-hidden className="text-amber-600" />
                      {value === 'delta' ? (
                        // width from 0 to auto (interpolate-size), so the bar makes room rather than jumping
                        <span className="w-auto overflow-hidden transition-[width] duration-200 ease-out [interpolate-size:allow-keywords] starting:w-0 motion-reduce:transition-none">
                          {label}
                        </span>
                      ) : (
                        label
                      )}
                    </TabFace>
                  </button>
                ))}
              </div>
              {/* the representation, shown only while it fits: when the bar fills, it wraps onto a clipped line */}
              <div className="flex h-4 min-w-0 flex-1 flex-wrap justify-end overflow-hidden pr-3 font-mono text-xs text-muted-foreground">
                <span className="h-4 w-0" />
                <span className="h-4 leading-4 whitespace-nowrap">application/vnd.afford+json</span>
              </div>
            </>
          }
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
          {/* out of flow, so the json scrolls inside the card instead of setting the row's height;
              both panels stay mounted, so a tint that lands while one is hidden plays when it's shown */}
          <div
            role="tabpanel"
            id={`${id}-graph`}
            aria-labelledby={`${id}-graph-tab`}
            ref={graphPanel}
            hidden={tab !== 'graph'}
            className="absolute inset-0 overflow-y-auto p-4 pl-7"
          >
            <JsonView value={graph} highlight={['entities.cart']} />
          </div>
          {delta && (
            <div
              role="tabpanel"
              id={`${id}-delta`}
              aria-labelledby={`${id}-delta-tab`}
              hidden={tab !== 'delta'}
              className="absolute inset-0 overflow-y-auto p-4 pl-7"
            >
              {/* remounts per call, so the tint re-flashes each time a delta lands */}
              <div
                key={calls}
                className="-mx-3 -mt-1 rounded-lg px-3 py-1 animate-json-changed motion-reduce:[animation-timing-function:steps(1,end)]"
              >
                <JsonView value={delta} />
              </div>
            </div>
          )}
        </Frame>
      </div>
    </div>
  )
}

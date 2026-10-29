'use client'

import { useState } from 'react'
import type { Delta, Graph } from '@afford/protocol'
import fixture from '@afford/protocol/fixtures/valid/graph.product.json'
import addToCart from '@afford/protocol/fixtures/valid/delta.add-to-cart.json'
import { Button } from '@afford/ui/components/button'
import { JsonView } from '@afford/ui/components/json-view'
import { ToggleGroup, ToggleGroupItem } from '@afford/ui/components/toggle-group'

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

const Label = ({ children, detail }: { children: React.ReactNode; detail: string }) => (
  <p className="mb-3 flex items-baseline gap-3 text-xs">
    <span className="font-pixel text-foreground">{children}</span>
    <span className="truncate font-mono text-muted-foreground">{detail}</span>
  </p>
)

// one url, two readers: the product page a person sees, and the graph an agent reads, driven by the same state
export const TwoViews = () => {
  const [view, setView] = useState<'human' | 'agent'>('human')
  const [graph, setGraph] = useState(initial)
  const [delta, setDelta] = useState<Delta | null>(null)
  const [sku, setSku] = useState(product.variants[0]!.sku)

  const cart = graph.entities.cart as Cart
  const variant = product.variants.find((v) => v.sku === sku)!
  const inStock = variant.stock > 0

  const add = () => {
    const next = deltaFor(cart, variant)
    setDelta(next)
    setGraph({ ...graph, entities: { ...graph.entities, ...next.changed } })
  }

  return (
    <figure className="flex flex-col overflow-hidden rounded-lg border border-border-illustration bg-card">
      <figcaption className="flex h-12 items-center justify-between gap-3 px-2">
        <ToggleGroup
          aria-label="View"
          value={[view]}
          onValueChange={([next]) => next && setView(next as typeof view)}
          spacing={0}
          className="gap-0.5 rounded-lg bg-muted p-0.5"
        >
          {(['human', 'agent'] as const).map((value) => (
            <ToggleGroupItem
              key={value}
              value={value}
              className="h-7 rounded-md px-3 text-xs text-muted-foreground capitalize hover:bg-transparent aria-pressed:bg-background aria-pressed:text-foreground dark:aria-pressed:bg-secondary"
            >
              {value}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <span className="truncate font-mono text-xs text-muted-foreground">{graph.page}</span>
      </figcaption>

      {/* both views stay mounted, so the agent view's highlight plays when it's shown after a change */}
      <div className="h-[27rem] rounded-md border bg-illustration mx-1 mb-1">
        <div hidden={view !== 'human'} className="flex h-full flex-col p-5 sm:p-6">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Afford Supply</span>
            <span className="tabular-nums">
              Cart <span className="text-foreground">{cart.count}</span>
            </span>
          </div>

          <div className="my-auto">
            <div className="flex items-baseline justify-between gap-4">
              <h3 className="text-2xl font-semibold tracking-tight">{product.name}</h3>
              <p className="text-lg tabular-nums">{money(product.price)}</p>
            </div>
            <p className="mt-1 text-sm text-muted-foreground capitalize">{variant.color}</p>

            <fieldset className="mt-6">
              <legend className="text-xs text-muted-foreground">Size</legend>
              <ToggleGroup
                value={[sku]}
                onValueChange={([next]) => next && setSku(next)}
                spacing={2}
                className="mt-2"
              >
                {product.variants.map((v) => (
                  <ToggleGroupItem
                    key={v.sku}
                    value={v.sku}
                    aria-label={v.stock ? `Size ${v.size}` : `Size ${v.size}, sold out`}
                    className="h-9 min-w-12 border border-border px-3 text-sm aria-pressed:border-foreground aria-pressed:bg-transparent data-[sold=true]:border-dashed data-[sold=true]:text-muted-foreground"
                    data-sold={v.stock === 0}
                  >
                    {v.size}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </fieldset>

            <div className="mt-6 flex flex-wrap items-center gap-2">
              {inStock ? (
                <Button data-afford-action="addToCart" onClick={add} className="h-9 px-4 text-sm">
                  Add to cart
                </Button>
              ) : (
                <Button
                  data-afford-action={notify?.name}
                  disabled
                  variant="outline"
                  className="h-9 px-4 text-sm"
                >
                  Notify me
                </Button>
              )}
            </div>
            <p aria-live="polite" className="mt-3 min-h-5 text-sm text-muted-foreground">
              {inStock
                ? (delta?.message ??
                  `${cart.count} ${cart.count === 1 ? 'item' : 'items'} in your cart, ${money(cart.subtotal)}`)
                : notify?.reason}
            </p>
          </div>
        </div>

        <div hidden={view !== 'agent'} className="h-full overflow-y-auto p-5 pl-7 sm:p-6 sm:pl-8">
          {delta && (
            <div className="mb-6">
              <Label detail="POST addToCart">Delta</Label>
              <JsonView value={delta} highlight={['changed']} />
            </div>
          )}
          <Label detail="Accept: application/vnd.afford+json">Graph</Label>
          <JsonView value={graph} highlight={['entities.cart']} />
        </div>
      </div>
    </figure>
  )
}

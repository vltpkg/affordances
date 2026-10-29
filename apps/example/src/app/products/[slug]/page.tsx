import { AgentText } from '@afford/md/react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { Affordance } from '@afford/react'
import { cn } from 'cn'
import { ProductArt } from '@/components/product-art'
import { SubmitButton } from '@/components/submit-button'
import { getSessionId } from '@/lib/session'
import { getProduct, listProducts } from '@/lib/store'
import { listing } from '../../state'
import { addToCart } from './actions'
import { loadProduct, remaining, type ProductState } from './state'

export const generateStaticParams = () => listProducts().map(({ slug }) => ({ slug }))

export const generateMetadata = async ({
  params,
}: PageProps<'/products/[slug]'>): Promise<Metadata> => ({
  title: getProduct((await params).slug)?.name ?? 'Not found',
})

// one honest sentence about what's scarce
const availability = ({ name, option, variants }: ProductState['product']) => {
  const notes = variants.flatMap((v) => {
    const left = remaining(v)
    const what = option ? `${option} ${v.label}` : name
    if (v.stock === 0) return `${what} is sold out.`
    if (left === 0) return `Every ${what} in stock is in your cart.`
    if (left <= 3) return option ? `${left} left in ${v.label}.` : `${left} left.`
    return []
  })
  return notes.length ? notes.join(' ') : 'In stock.'
}

const Purchase = async ({ slug }: { slug: string }) => {
  const { product } = loadProduct(slug, await getSessionId())!
  const available = product.variants.filter((v) => remaining(v) > 0)
  // the form resets after adding, so keep the variant that was just added selected
  const open = available.find((v) => v.inCart) ?? available[0]
  const inCart = product.variants.reduce((sum, v) => sum + (v.inCart ?? 0), 0)
  const pricesDiffer = new Set(product.variants.map((v) => v.price)).size > 1

  return (
    <Affordance action={addToCart} input={product.option || !open ? undefined : { sku: open.sku }}>
      <form action={addToCart} className="mt-8">
        {product.option ? (
          <fieldset>
            <legend className="text-sm font-medium">{product.option}</legend>
            <div className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-2">
              {product.variants.map((v) => (
                <label
                  key={v.sku}
                  className={cn(
                    'flex h-11 cursor-pointer flex-col items-center justify-center rounded-md border text-sm transition-colors duration-150 ease-out',
                    'hover:border-ring has-checked:border-foreground has-focus-visible:ring-2 has-focus-visible:ring-ring/30',
                    'has-disabled:cursor-not-allowed has-disabled:border-border has-disabled:text-muted-foreground has-disabled:line-through',
                  )}
                >
                  <input
                    type="radio"
                    name="sku"
                    value={v.sku}
                    defaultChecked={v === open}
                    disabled={remaining(v) <= 0}
                    className="sr-only"
                  />
                  {v.label}
                  {pricesDiffer && (
                    <span className="font-mono text-xs text-muted-foreground tabular-nums">
                      {v.price}
                    </span>
                  )}
                </label>
              ))}
            </div>
          </fieldset>
        ) : (
          open && <input type="hidden" name="sku" value={open.sku} />
        )}
        <p className="mt-3 text-sm text-muted-foreground">{availability(product)}</p>
        <SubmitButton size="lg" className="mt-6 h-9 w-full text-sm" disabled={!open}>
          {open ? 'Add to cart' : 'Sold out'}
        </SubmitButton>
        {inCart > 0 && (
          <p className="mt-3 text-sm text-muted-foreground motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200">
            {inCart} in your cart.{' '}
            <Link href="/cart" className="text-foreground underline underline-offset-4">
              View cart
            </Link>
          </p>
        )}
      </form>
    </Affordance>
  )
}

const back = (
  <Link
    href="/"
    className="rounded-sm text-sm text-muted-foreground outline-none transition-colors duration-150 ease-out hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30"
  >
    Index
  </Link>
)

const Product = ({ slug }: { slug: string }) => {
  const product = getProduct(slug)
  if (!product) notFound()

  return (
    <div className="mt-6 grid gap-8 md:grid-cols-2 md:gap-12">
      <ProductArt slug={slug} className="self-start max-md:aspect-[4/3] md:sticky md:top-24" />
      <div>
        <p className="text-sm text-muted-foreground">{product.category}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-balance">{product.name}</h1>
        <p className="mt-2 font-mono tabular-nums">{listing(product).price}</p>
        <p className="mt-6 max-w-prose text-pretty text-muted-foreground">{product.description}</p>
        <Suspense fallback={<div className="mt-8 h-40" />}>
          <Purchase slug={slug} />
        </Suspense>
        <dl className="mt-10 border-t text-sm">
          {Object.entries(product.details).map(([term, detail]) => (
            <div key={term} className="grid grid-cols-[7rem_1fr] gap-4 border-b py-2.5">
              <dt className="text-muted-foreground">{term}</dt>
              <dd>{detail}</dd>
            </div>
          ))}
          <div className="grid grid-cols-[7rem_1fr] gap-4 border-b py-2.5">
            <dt className="text-muted-foreground">SKU</dt>
            <dd className="flex flex-wrap gap-x-3 font-mono text-xs leading-5">
              {/* the gap separates them on screen; agents get a list */}
              <AgentText md={product.variants.map((v) => v.sku).join(', ')}>
                {product.variants.map((v) => (
                  <span key={v.sku}>{v.sku}</span>
                ))}
              </AgentText>
            </dd>
          </div>
        </dl>
      </div>
    </div>
  )
}

// the slug is URL data, so the product streams behind a plate the same size as its art
const Page = ({ params }: PageProps<'/products/[slug]'>) => (
  <>
    {back}
    <Suspense
      fallback={
        <div className="mt-6 grid gap-8 md:grid-cols-2 md:gap-12">
          <div className="aspect-[4/3] rounded-md bg-muted md:aspect-square" />
        </div>
      }
    >
      {params.then(({ slug }) => (
        <Product slug={slug} />
      ))}
    </Suspense>
  </>
)

export default Page

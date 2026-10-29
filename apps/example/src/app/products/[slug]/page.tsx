import { AgentText } from '@affordances/md/react'
import { ChevronDownIcon } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { Affordance } from '@affordances/react'
import { cn } from 'cn'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@affordances/ui/components/breadcrumb'
import { Input } from '@affordances/ui/components/input'
import { Gallery } from '@/components/gallery'
import { ProductList } from '@/components/product-list'
import { Stars } from '@/components/rating'
import { SubmitButton } from '@/components/submit-button'
import { care, categoryHref, focus, getReviews, related, shipping } from '@/lib/content'
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
        <div className="mt-6 flex items-center gap-3">
          <label htmlFor="quantity" className="text-sm font-medium">
            Quantity
          </label>
          <Input
            id="quantity"
            name="quantity"
            type="number"
            inputMode="numeric"
            min={1}
            max={10}
            defaultValue={1}
            disabled={!open}
            className="h-9 w-16 text-center font-mono text-sm tabular-nums md:text-sm"
          />
          <SubmitButton size="lg" className="h-9 flex-1 text-sm" disabled={!open}>
            {open ? 'Add to cart' : 'Sold out'}
          </SubmitButton>
        </div>
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

const crumbs = (category: string, name: string) => (
  <Breadcrumb>
    <BreadcrumbList className="text-sm">
      <BreadcrumbItem>
        <BreadcrumbLink render={<Link href="/" />}>Home</BreadcrumbLink>
      </BreadcrumbItem>
      <BreadcrumbSeparator />
      <BreadcrumbItem>
        <BreadcrumbLink render={<Link href={categoryHref(category)} />}>{category}</BreadcrumbLink>
      </BreadcrumbItem>
      <BreadcrumbSeparator />
      <BreadcrumbItem>
        <BreadcrumbPage>{name}</BreadcrumbPage>
      </BreadcrumbItem>
    </BreadcrumbList>
  </Breadcrumb>
)

const date = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' })

const Reviews = ({ slug }: { slug: string }) => {
  const { counts, recent, count, average } = getReviews(slug)
  return (
    <section
      id="reviews"
      aria-labelledby="reviews-heading"
      className="mt-20 scroll-mt-20 border-t pt-12"
    >
      <h2 id="reviews-heading" className={heading}>
        Reviews
      </h2>
      <div className="mt-6 grid gap-10 md:grid-cols-[16rem_minmax(0,1fr)] md:gap-12">
        <div>
          <p className="flex items-center gap-3">
            <span className="text-3xl font-semibold tracking-tight tabular-nums">{average}</span>
            <Stars rating={average} />
          </p>
          <p className="mt-1 text-sm text-muted-foreground">Based on {count} reviews</p>
          <ul className="mt-5 space-y-1.5 text-xs text-muted-foreground">
            {counts.map((n, i) => (
              <li key={i} className="grid grid-cols-[3.5rem_1fr_2.5rem] items-center gap-2">
                <span>
                  {5 - i} {i === 4 ? 'star' : 'stars'}
                </span>
                <span aria-hidden className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-full rounded-full bg-foreground"
                    style={{ width: `${(n / count) * 100}%` }}
                  />
                </span>
                <span className="text-right font-mono tabular-nums">{n}</span>
              </li>
            ))}
          </ul>
        </div>
        <ul className="divide-y border-y">
          {recent.map((review) => (
            <li key={review.author}>
              <article className="py-5">
                <Stars rating={review.rating} />
                <h3 className="mt-2 font-medium">{review.title}</h3>
                <p className="mt-1 max-w-prose text-pretty text-muted-foreground">{review.body}</p>
                <p className="mt-3 text-xs text-muted-foreground">
                  {review.author}, {review.location} · Verified buyer ·{' '}
                  <time dateTime={review.date}>{date.format(new Date(review.date))}</time>
                  {review.bought && ` · ${review.bought}`}
                </p>
              </article>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

const disclosure = 'group border-b [&_summary::-webkit-details-marker]:hidden'
const summary =
  'flex cursor-pointer list-none items-center justify-between gap-4 rounded-sm py-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/30'

const More = ({ title, items }: { title: string; items: string[] }) => (
  <details className={disclosure}>
    <summary className={summary}>
      {title}
      <ChevronDownIcon
        aria-hidden
        className="size-4 text-muted-foreground transition-transform duration-200 ease-out group-open:rotate-180 motion-reduce:transition-none"
      />
    </summary>
    <ul className="space-y-1.5 pb-4 text-sm text-pretty text-muted-foreground">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  </details>
)

const heading = 'text-lg font-semibold tracking-tight'

const Product = ({ slug }: { slug: string }) => {
  const product = getProduct(slug)
  if (!product) notFound()

  const { average, count } = getReviews(slug)

  return (
    <>
      {crumbs(product.category, product.name)}
      <div className="mt-6 grid gap-8 md:grid-cols-2 md:gap-12">
        <Gallery
          slug={slug}
          name={product.name}
          focus={focus[slug]!}
          className="self-start md:sticky md:top-24"
        />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-balance">{product.name}</h1>
          <p className="mt-2 flex items-center gap-3">
            <span className="font-mono tabular-nums">{listing(product).price}</span>
            <a
              href="#reviews"
              className="flex items-center gap-1.5 rounded-sm text-sm text-muted-foreground outline-none transition-colors duration-150 ease-out hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30"
            >
              <Stars rating={average} />
              {count} reviews
            </a>
          </p>
          <p className="mt-6 max-w-prose text-pretty text-muted-foreground">
            {product.description}
          </p>
          <Suspense fallback={<div className="mt-8 h-56" />}>
            <Purchase slug={slug} />
          </Suspense>
          <ul className="mt-6 space-y-1 text-sm text-muted-foreground">
            <li>Free shipping, dispatched within 2 business days</li>
            <li>Free returns within 30 days</li>
          </ul>
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
          <More title="Shipping & returns" items={shipping} />
          <More title="Care" items={care[slug]!} />
        </div>
      </div>
      <Reviews slug={slug} />
      <section aria-labelledby="related" className="mt-20 border-t pt-12">
        <h2 id="related" className={heading}>
          You may also like
        </h2>
        <ProductList products={related(slug).map(listing)} className="mt-6" />
      </section>
    </>
  )
}

// the slug is URL data, so the product streams behind a plate the same size as its art
const Page = ({ params }: PageProps<'/products/[slug]'>) => (
  <Suspense
    fallback={
      <div className="mt-11 grid gap-8 md:grid-cols-2 md:gap-12">
        <div className="aspect-[4/3] rounded-md bg-muted md:aspect-square" />
      </div>
    }
  >
    {params.then(({ slug }) => (
      <Product slug={slug} />
    ))}
  </Suspense>
)

export default Page

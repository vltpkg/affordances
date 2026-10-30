import Link from 'next/link'
import { connection } from 'next/server'
import { Suspense } from 'react'
import { buttonVariants } from '@affordances/ui/components/button'
import { cn } from 'cn'
import { ProductArt } from '@/components/product-art'
import { ProductList } from '@/components/product-list'
import { Stars } from '@/components/rating'
import { categories, categoryBlurbs, categoryHref, getReviews, testimonials } from '@/lib/content'
import { listProducts } from '@/lib/store'
import { loadIndex } from './state'

// stock changes as orders come in, so the list renders per request
const Products = async () => {
  await connection()
  return <ProductList products={loadIndex().products} className="mt-6" />
}

const all = listProducts().map((p) => getReviews(p.slug))
const reviewCount = all.reduce((sum, r) => sum + r.count, 0)
const average =
  Math.round((all.reduce((sum, r) => sum + r.average * r.count, 0) / reviewCount) * 10) / 10

const heading = 'text-lg font-semibold tracking-tight'

const Page = () => (
  <>
    <section className="grid items-center gap-8 md:grid-cols-2 md:gap-12">
      <div>
        <p className="text-sm text-muted-foreground">New: the Grid Poster, now in A2</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          Studio goods, made in small runs
        </h1>
        <p className="mt-4 max-w-md text-pretty text-muted-foreground">
          Heavy cotton, thick keycaps, and paper that takes a fountain pen. Things for the desk, the
          wall, and the walk in between.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Link href="#products" className={cn(buttonVariants({ size: 'lg' }), 'h-9 px-4 text-sm')}>
            Shop all products
          </Link>
          <Link
            href="/products/grid-poster"
            className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'h-9 px-4 text-sm')}
          >
            See the poster
          </Link>
        </div>
      </div>
      <ProductArt slug="grid-poster" className="aspect-[4/3]" />
    </section>

    <section aria-labelledby="categories" className="mt-20">
      <h2 id="categories" className={heading}>
        Shop by category
      </h2>
      <ul className="mt-6 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-4 sm:gap-x-6">
        {categories().map(([category, products]) => (
          <li key={category} className="group relative">
            <ProductArt
              slug={products[0]!.slug}
              className="aspect-[4/3] transition-colors duration-150 ease-out group-hover:bg-accent"
            />
            <h3 className="mt-3 text-sm font-medium">
              <Link
                href={categoryHref(category)}
                className="outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:ring-2 focus-visible:after:ring-ring/30"
              >
                {category}
              </Link>
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">{categoryBlurbs[category]}</p>
          </li>
        ))}
      </ul>
    </section>

    <section id="products" aria-labelledby="products-heading" className="mt-20 scroll-mt-20">
      <h2 id="products-heading" className={heading}>
        All products
      </h2>
      <Suspense>
        <Products />
      </Suspense>
    </section>

    <section aria-labelledby="customers" className="mt-20 border-t pt-12">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
        <h2 id="customers" className={heading}>
          What customers say
        </h2>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Stars rating={average} />
          {average} from {reviewCount.toLocaleString('en-US')} reviews
        </p>
      </div>
      <ul className="mt-8 grid gap-8 sm:grid-cols-3">
        {testimonials.map((t) => (
          <li key={t.author}>
            <figure>
              <blockquote className="text-pretty">“{t.quote}”</blockquote>
              <figcaption className="mt-3 text-sm text-muted-foreground">
                {t.author}, on the {t.detail}
              </figcaption>
            </figure>
          </li>
        ))}
      </ul>
    </section>
  </>
)

export default Page

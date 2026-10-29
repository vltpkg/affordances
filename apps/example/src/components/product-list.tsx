import Link from 'next/link'
import { cn } from 'cn'
import type { listing } from '@/app/state'
import { getReviews } from '@/lib/content'
import { ProductArt } from './product-art'
import { Stars } from './rating'

type Listing = ReturnType<typeof listing>

// the name is the link, stretched over the card, so the card reads as one link named for the product
export const ProductCard = ({ product }: { product: Listing }) => {
  const slug = product.href.split('/').at(-1)!
  const { average, count } = getReviews(slug)
  return (
    <li className="group relative">
      <ProductArt
        slug={slug}
        className="transition-colors duration-150 ease-out group-hover:bg-accent"
      />
      <h3 className="mt-3 text-sm font-medium text-balance">
        <Link
          href={product.href}
          className="outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:ring-2 focus-visible:after:ring-ring/30"
        >
          {product.name}
        </Link>
      </h3>
      <p
        className={cn(
          'mt-0.5 font-mono text-sm tabular-nums',
          !product.inStock && 'text-muted-foreground line-through',
        )}
      >
        {product.price}
      </p>
      <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Stars rating={average} />
        <span aria-hidden>({count})</span>
        <span className="sr-only">{count} reviews</span>
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {product.inStock ? product.options : 'Sold out'}
      </p>
    </li>
  )
}

export const ProductList = ({
  products,
  className,
}: {
  products: Listing[]
  className?: string
}) => (
  <ul className={cn('grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-4 sm:gap-x-6', className)}>
    {products.map((product) => (
      <ProductCard key={product.href} product={product} />
    ))}
  </ul>
)

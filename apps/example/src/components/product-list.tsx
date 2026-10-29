import Link from 'next/link'
import { cn } from 'cn'
import type { listing } from '@/app/state'
import { ProductArt } from './product-art'

const columns =
  'grid-cols-[3.5rem_minmax(0,1fr)_auto] sm:grid-cols-[4rem_minmax(0,1fr)_7rem_7rem_7rem]'

export const ProductList = ({
  products,
  className,
}: {
  products: ReturnType<typeof listing>[]
  className?: string
}) => (
  <div className={className}>
    <div
      aria-hidden
      className={cn('hidden gap-x-4 pb-2 text-xs text-muted-foreground sm:grid', columns)}
    >
      <span />
      <span>Item</span>
      <span>Category</span>
      <span>Options</span>
      <span className="text-right">Price</span>
    </div>
    <ul className="border-t">
      {products.map((product) => {
        const status = !product.inStock ? 'Sold out' : product.options
        return (
          <li key={product.href} className="border-b">
            <Link
              href={product.href}
              className={cn(
                'group grid items-center gap-x-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring/30',
                columns,
              )}
            >
              <ProductArt slug={product.href.split('/').at(-1)!} />
              <div className="min-w-0">
                <p className="truncate font-medium">{product.name}</p>
                <p className="truncate text-sm text-muted-foreground sm:hidden">
                  {product.category}, {status.toLowerCase()}
                </p>
              </div>
              <p className="hidden text-sm text-muted-foreground transition-colors duration-150 ease-out group-hover:text-foreground sm:block">
                {product.category}
              </p>
              <p className="hidden text-sm text-muted-foreground transition-colors duration-150 ease-out group-hover:text-foreground sm:block">
                {status}
              </p>
              <p
                className={cn(
                  'text-right font-mono text-sm tabular-nums',
                  !product.inStock && 'text-muted-foreground line-through',
                )}
              >
                {product.price}
              </p>
            </Link>
          </li>
        )
      })}
    </ul>
  </div>
)

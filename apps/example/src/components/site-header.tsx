import { SearchIcon, ShoppingBagIcon, UserRoundIcon } from 'lucide-react'
import Link from 'next/link'
import { Suspense } from 'react'
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from '@affordances/ui/components/navigation-menu'
import { categories, categoryBlurbs, categoryHref } from '@/lib/content'
import { getSessionId } from '@/lib/session'
import { cartCount } from '@/lib/store'
import { AgentViewToggle } from './agent-view'
import { ProductArt } from './product-art'
import { SearchForm } from './search-form'

const CartCount = async () => {
  const count = cartCount(await getSessionId())
  // the space keeps the link's name "Cart 2", not "Cart2"
  return count ? ` ${count}` : null
}

const focus = 'outline-none focus-visible:ring-2 focus-visible:ring-ring/30'
const icon = `inline-flex h-8 items-center gap-1 rounded-md px-2 text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground ${focus}`

// a dropdown per category, like a small shop's mega menu: its products, then the whole category
const Categories = () => (
  <NavigationMenu aria-label="Main" className="max-md:hidden">
    <NavigationMenuList className="gap-0">
      {categories().map(([category, products]) => (
        <NavigationMenuItem key={category}>
          <NavigationMenuTrigger className="h-8 px-3 font-normal text-muted-foreground hover:bg-transparent hover:text-foreground focus:bg-transparent data-popup-open:bg-transparent data-popup-open:text-foreground">
            {category}
          </NavigationMenuTrigger>
          <NavigationMenuContent>
            <div className="w-72 p-1">
              <p className="px-2 pt-1 pb-2 text-xs text-muted-foreground">
                {categoryBlurbs[category]}
              </p>
              <ul>
                {products.map((product) => (
                  <li key={product.slug}>
                    <NavigationMenuLink
                      render={<Link href={`/products/${product.slug}`} />}
                      className="flex-row items-center gap-3"
                    >
                      <ProductArt slug={product.slug} className="size-10 shrink-0" />
                      {product.name}
                    </NavigationMenuLink>
                  </li>
                ))}
                <li className="mt-1 border-t pt-1">
                  <NavigationMenuLink render={<Link href={categoryHref(category)} />}>
                    Shop all {category.toLowerCase()}
                  </NavigationMenuLink>
                </li>
              </ul>
            </div>
          </NavigationMenuContent>
        </NavigationMenuItem>
      ))}
    </NavigationMenuList>
  </NavigationMenu>
)

export const SiteHeader = () => (
  <>
    <section
      aria-label="Announcement"
      className="bg-foreground px-4 py-2 text-center text-xs text-background"
    >
      Free shipping on every order, and free returns for 30 days.
    </section>
    <header className="sticky top-0 z-10 border-b bg-background">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-4 px-4 sm:px-6">
        <Link href="/" className={`flex items-baseline gap-2 rounded-md ${focus}`}>
          <span className="text-[17px] font-semibold tracking-tight">Acme Store</span>
        </Link>
        <Categories />
        <div className="-mr-2 ml-auto flex items-center gap-1">
          <SearchForm id="site-search" className="mr-1 max-sm:hidden sm:w-48 lg:w-56" />
          <Link href="/search" className={`${icon} sm:hidden`}>
            <SearchIcon aria-hidden className="size-4" />
            <span className="sr-only">Search</span>
          </Link>
          <AgentViewToggle />
          <Link href="/account/orders" className={icon}>
            <UserRoundIcon aria-hidden className="size-4" />
            <span className="sr-only">Account</span>
          </Link>
          <Link href="/cart" className={icon}>
            <ShoppingBagIcon aria-hidden className="size-4" />
            <span className="sr-only">Cart</span>
            <span className="min-w-[1ch] font-mono text-sm text-foreground tabular-nums">
              <Suspense>
                <CartCount />
              </Suspense>
            </span>
          </Link>
        </div>
      </div>
      <nav aria-label="Categories" className="border-t md:hidden">
        <ul className="mx-auto flex h-10 max-w-5xl items-center gap-1 overflow-x-auto px-2">
          {categories().map(([category]) => (
            <li key={category}>
              <Link href={categoryHref(category)} className={`${icon} text-sm`}>
                {category}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  </>
)

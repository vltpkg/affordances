import { connection } from 'next/server'
import { Suspense } from 'react'
import { ProductList } from '@/components/product-list'
import { SearchForm } from '@/components/search-form'
import { loadIndex } from './state'

// stock changes as orders come in, so the list renders per request
const Products = async () => {
  await connection()
  return <ProductList products={loadIndex().products} className="mt-10" />
}

const Page = () => (
  <>
    <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Studio goods</h1>
        <p className="mt-2 max-w-md text-pretty text-muted-foreground">
          Things for the desk, the wall, and the walk in between. Made in small runs.
        </p>
      </div>
      <SearchForm />
    </div>
    <Suspense>
      <Products />
    </Suspense>
  </>
)

export default Page

import type { Metadata } from 'next'
import { Suspense } from 'react'
import { ProductList } from '@/components/product-list'
import { SearchForm } from '@/components/search-form'
import { loadSearch } from './state'

export const metadata: Metadata = { title: 'Search' }

const Results = async ({ searchParams }: Pick<PageProps<'/search'>, 'searchParams'>) => {
  const { q } = await searchParams
  const { search } = loadSearch(typeof q === 'string' ? q.trim() : '')
  const count = search.results.length
  return (
    <>
      <SearchForm key={search.query} defaultValue={search.query} className="mt-6 sm:w-80" />
      {search.query && (
        <p className="mt-8 text-sm text-muted-foreground" aria-live="polite">
          {count ? `${count} ${count === 1 ? 'result' : 'results'}` : 'No results'} for “
          {search.query}”
        </p>
      )}
      {count > 0 && <ProductList products={search.results} className="mt-4" />}
    </>
  )
}

const Page = ({ searchParams }: PageProps<'/search'>) => (
  <>
    <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
    <Suspense fallback={<SearchForm className="mt-6 sm:w-80" />}>
      <Results searchParams={searchParams} />
    </Suspense>
  </>
)

export default Page

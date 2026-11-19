import Link from 'next/link'
import { notFound } from 'next/navigation'
import { usd } from '@/components/usd'
import { planPage } from './plan'

export const dynamic = 'force-dynamic'

const Page = async ({ params }: PageProps<'/plans/[slug]'>) => {
  const page = planPage((await params).slug)
  if (!page) notFound()
  const { plan, servedFrom } = page
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{plan.name}</h1>
      <p className="text-sm">{usd(plan.priceUsd)}</p>
      <section aria-labelledby="served-from" className="flex flex-col gap-2">
        <h2 id="served-from" className="text-lg font-medium">
          Served from
        </h2>
        <ul className="text-sm">
          {servedFrom.map((r) => (
            <li key={r.slug}>
              {r.name} ({r.jurisdiction})
            </li>
          ))}
        </ul>
      </section>
      <Link href="/plans" className="text-sm underline">
        All plans
      </Link>
    </div>
  )
}

export default Page

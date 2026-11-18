import { Button } from '@affordances/ui/components/button'
import { bundles } from '@/catalog'
import { currentPlans } from '@/lib/store'
import { usd } from '@/components/usd'
import { currentAccount } from '@/lib/view'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Plans' }

const Page = async () => {
  const { project } = await currentAccount()
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Plans</h1>
      <ul className="grid gap-4 sm:grid-cols-3">
        {currentPlans().map((p) => {
          const current = p.slug === project.plan && !project.bundle
          return (
            <li key={p.id} className="flex flex-col gap-2 rounded-md border p-4">
              <h2 className="font-medium">{p.name}</h2>
              <p className="text-sm">{usd(p.priceUsd)}</p>
              <ul className="text-sm text-muted-foreground">
                <li>{p.buildMinutes.toLocaleString('en')} build minutes</li>
                <li>{p.bandwidthGb.toLocaleString('en')} GB bandwidth</li>
                <li>{p.rollback ? 'Instant rollback' : 'No rollback'}</li>
                <li>{p.support} support</li>
              </ul>
              {current ? (
                <p className="text-sm font-medium">Current plan</p>
              ) : (
                // a purchase goes through its review-and-confirm step first (src/app/review)
                <form method="get" action="/review">
                  <input type="hidden" name="action" value="subscribe" />
                  <input type="hidden" name="plan" value={p.id} />
                  <input type="hidden" name="projectId" value={project.id} />
                  <Button type="submit" size="sm">
                    Move to {p.name}
                  </Button>
                </form>
              )}
            </li>
          )
        })}
      </ul>
      <h2 className="text-lg font-medium">Bundles</h2>
      <ul className="flex flex-col gap-3">
        {bundles.map((b) => (
          <li key={b.slug} className="flex items-center justify-between rounded-md border p-4">
            <div>
              <p className="font-medium">{b.name}</p>
              <p className="text-sm text-muted-foreground">
                {b.plan} with {b.addOns.join(', ')}, {usd(b.priceUsd)}
              </p>
            </div>
            {project.bundle === b.slug ? (
              <p className="text-sm font-medium">Current</p>
            ) : (
              <form method="get" action="/review">
                <input type="hidden" name="action" value="subscribeBundle" />
                <input type="hidden" name="bundle" value={b.slug} />
                <input type="hidden" name="projectId" value={project.id} />
                <Button type="submit" size="sm">
                  Move to {b.name}
                </Button>
              </form>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

export default Page

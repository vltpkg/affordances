import { Button } from '@affordances/ui/components/button'
import { currentAccount, summary } from '@/lib/view'
import { cancel } from './actions'

export const dynamic = 'force-dynamic'

const Page = async () => {
  const a = await currentAccount()
  const s = summary(a)
  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="project" className="flex flex-col gap-3">
        <h1 id="project" className="text-2xl font-semibold">
          {s.project}
        </h1>
        <dl className="grid grid-cols-[10rem_1fr] gap-y-1 text-sm">
          <dt className="text-muted-foreground">Plan</dt>
          <dd>{s.plan}</dd>
          <dt className="text-muted-foreground">Renews as</dt>
          <dd>{s.renewsAs}</dd>
          <dt className="text-muted-foreground">Monthly</dt>
          <dd>${s.monthlyUsd}</dd>
          <dt className="text-muted-foreground">Add-ons</dt>
          <dd>{s.addOns.length ? s.addOns.join(', ') : 'None'}</dd>
          <dt className="text-muted-foreground">Build minutes</dt>
          <dd>
            {s.buildMinutes.used} of {s.buildMinutes.included} this month
          </dd>
        </dl>
        {s.renewsAs !== 'Hobby' && (
          <form
            action={async () => {
              'use server'
              await cancel({ projectId: a.project.id })
            }}
          >
            <Button type="submit" variant="outline" size="sm">
              Cancel: renew as Hobby
            </Button>
          </form>
        )}
      </section>
      <section aria-labelledby="charges" className="flex flex-col gap-2">
        <h2 id="charges" className="text-lg font-medium">
          Charges
        </h2>
        {a.ledger.length ? (
          <ul className="text-sm">
            {a.ledger.map((c) => (
              <li key={`${c.at}${c.description}`} className="flex justify-between border-b py-1">
                <span>{c.description}</span>
                <span>${c.usd}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No charges.</p>
        )}
      </section>
    </div>
  )
}

export default Page

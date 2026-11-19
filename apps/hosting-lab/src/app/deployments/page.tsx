import { Button } from '@affordances/ui/components/button'
import { Input } from '@affordances/ui/components/input'
import { deploymentList } from '@/lib/store'
import { currentAccount, summary } from '@/lib/view'
import { deploy, rollback } from './actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Deployments' }

const Page = async () => {
  const a = await currentAccount()
  const { buildMinutes } = summary(a)
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Deployments</h1>
      <p className="text-sm text-muted-foreground">
        {buildMinutes.used} of {buildMinutes.included} build minutes used this month
      </p>
      <form
        action={async (form: FormData) => {
          'use server'
          await deploy(form)
        }}
        className="flex gap-2"
      >
        <label htmlFor="ref" className="sr-only">
          Git ref
        </label>
        <input type="hidden" name="projectId" value={a.project.id} />
        <Input id="ref" name="ref" placeholder="main" required className="max-w-60" />
        <Button type="submit">Deploy</Button>
      </form>
      <ul className="flex flex-col gap-2 text-sm">
        {deploymentList(a.project).map((d) => (
          <li key={d.id} className="flex items-center justify-between rounded-md border p-3">
            <span>
              {d.id} · {d.ref} · {d.status}
              {d.current && ' · published'}
            </span>
            {!d.current && d.status === 'ready' && summary(a).rollback && (
              <form
                action={async (form: FormData) => {
                  'use server'
                  await rollback(form)
                }}
              >
                <input type="hidden" name="deployment" value={d.id} />
                <Button type="submit" size="sm" variant="outline">
                  Roll back to this
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

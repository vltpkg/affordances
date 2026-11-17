import { Button } from '@affordances/ui/components/button'
import { addOns } from '@/catalog'
import { usd } from '@/components/usd'
import { effectiveAddOns } from '@/lib/store'
import { currentAccount } from '@/lib/view'
import { addAddOn, removeAddOn } from './actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Add-ons' }

const Page = async () => {
  const { project } = await currentAccount()
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Add-ons</h1>
      <ul className="flex flex-col gap-3">
        {addOns.map((a) => {
          const included =
            effectiveAddOns(project).includes(a.slug) && !project.addOns.includes(a.slug)
          const added = project.addOns.includes(a.slug)
          const removing = project.removing.includes(a.slug)
          return (
            <li key={a.slug} className="flex items-center justify-between rounded-md border p-4">
              <div>
                <p className="font-medium">{a.name}</p>
                <p className="text-sm text-muted-foreground">
                  {usd(a.priceUsd)}
                  {removing && ', stops at the end of the month'}
                  {included && ', included in your bundle'}
                </p>
              </div>
              {included ? null : (
                <form
                  action={async (form: FormData) => {
                    'use server'
                    await (added && !removing ? removeAddOn : addAddOn)(form)
                  }}
                >
                  <input type="hidden" name="addOn" value={a.slug} />
                  <input type="hidden" name="projectId" value={project.id} />
                  <Button
                    type="submit"
                    size="sm"
                    variant={added && !removing ? 'outline' : 'default'}
                  >
                    {added && !removing ? 'Remove' : 'Add'}
                  </Button>
                </form>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export default Page

import { defineState } from '@/lib/affordances'
import { addOns } from '@/catalog'
import { accountFor } from '@/lib/view'

export default defineState(
  ({ ctx }) => {
    const project = accountFor(ctx.session?.id).project
    return {
      addOns: addOns.map((a) => ({
        slug: a.slug,
        name: a.name,
        priceUsd: a.priceUsd,
        added: project.addOns.includes(a.slug),
        removing: project.removing.includes(a.slug),
      })),
    }
  },
  { description: 'Add-ons a project can have on top of its plan, each billed monthly' },
)

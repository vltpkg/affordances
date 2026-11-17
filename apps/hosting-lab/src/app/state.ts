import { defineState } from '@/lib/affordances'
import { accountFor, summary } from '@/lib/view'

export default defineState(
  ({ ctx }) => {
    const a = accountFor(ctx.session?.id)
    return { project: summary(a), charges: a.ledger }
  },
  {
    description:
      "Your project: its plan, what it renews as, its add-ons, this month's build minutes, and every charge so far",
    nav: () => [
      { to: '/plans', label: 'Plans' },
      { to: '/add-ons', label: 'Add-ons' },
      { to: '/deployments', label: 'Deployments' },
    ],
  },
)

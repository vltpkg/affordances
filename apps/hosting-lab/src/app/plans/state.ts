import { defineState } from '@/lib/affordances'
import { bundles } from '@/catalog'
import { currentPlans } from '@/lib/store'
import { accountFor } from '@/lib/view'

export default defineState(
  ({ ctx }) => {
    const { project } = accountFor(ctx.session?.id)
    return {
      project: { id: project.id, plan: project.plan, bundle: project.bundle },
      plans: currentPlans().map((p) => ({
        ...p,
        current: p.slug === project.plan && !project.bundle,
      })),
      bundles: bundles.map((b) => ({ ...b, current: b.slug === project.bundle })),
    }
  },
  {
    description:
      'Every plan and bundle, with its price, limits, rollback and support, and which one the project is on',
  },
)

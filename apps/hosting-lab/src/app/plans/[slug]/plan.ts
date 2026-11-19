import { regions } from '@/catalog'
import { currentPlans } from '@/lib/store'

// one plan's page (M8e's T8, results/surfaces-t8/PLAN.md §3): the plan, and every region it's served from, as a complete
// list, so that a plan that isn't served from a region reads as missing from the list, not as left unsaid. The plans
// page doesn't show regions: this page is its one step, as an expansion is the graph's
export const planPage = (slug: string) => {
  const plan = currentPlans().find((p) => p.slug === slug)
  if (!plan) return null
  return {
    plan,
    servedFrom: regions
      .filter((r) => r.plans.includes(plan.slug))
      .map((r) => ({ slug: r.slug, name: r.name, jurisdiction: r.jurisdiction })),
  }
}

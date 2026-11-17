// the fixed option set: a fictional hosting provider's plans, add-ons and bundle. Every benchmark condition shares
// these exact values; only how they're disclosed changes. The prices are invented for the experiment, and belong to
// no real provider

export type Plan = {
  slug: 'hobby' | 'pro' | 'business'
  name: string
  priceUsd: number // a month
  buildMinutes: number // a month
  bandwidthGb: number // a month
  rollback: boolean // instant rollback to an earlier deployment
  support: 'community' | 'email' | 'priority'
}

export const plans: readonly Plan[] = [
  {
    slug: 'hobby',
    name: 'Hobby',
    priceUsd: 0,
    buildMinutes: 100,
    bandwidthGb: 10,
    rollback: false,
    support: 'community',
  },
  {
    slug: 'pro',
    name: 'Pro',
    priceUsd: 20,
    buildMinutes: 3000,
    bandwidthGb: 100,
    rollback: true,
    support: 'email',
  },
  {
    slug: 'business',
    name: 'Business',
    priceUsd: 80,
    buildMinutes: 10000,
    bandwidthGb: 1000,
    rollback: true,
    support: 'priority',
  },
]

export type AddOn = {
  slug: 'priority-support' | 'extra-bandwidth' | 'daily-backups'
  name: string
  priceUsd: number // a month
}

export const addOns: readonly AddOn[] = [
  { slug: 'priority-support', name: 'Priority support', priceUsd: 20 },
  { slug: 'extra-bandwidth', name: 'Extra bandwidth, 100 GB', priceUsd: 10 },
  { slug: 'daily-backups', name: 'Daily backups', priceUsd: 5 },
]

// one plan and add-ons for one price: less than buying them separately (20 + 20), and more than the plan alone
export type Bundle = {
  slug: 'pro-plus'
  name: string
  plan: Plan['slug']
  addOns: AddOn['slug'][]
  priceUsd: number
}

export const bundles: readonly Bundle[] = [
  { slug: 'pro-plus', name: 'Pro Plus', plan: 'pro', addOns: ['priority-support'], priceUsd: 35 },
]

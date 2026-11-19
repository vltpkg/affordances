// the fixed option set: a fictional hosting provider's plans, add-ons and bundle. Every benchmark condition shares
// these exact values; only how they're disclosed changes. The prices are invented for the experiment, and belong to
// no real provider

export type Plan = {
  // the resource key: opaque, and permuted per trial, so canonical order (by id) varies while the data doesn't
  // (RFC 0003 §4). Everything the manifest reads uses slug
  id: string
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
    id: 'p1',
    slug: 'hobby',
    name: 'Hobby',
    priceUsd: 0,
    buildMinutes: 100,
    bandwidthGb: 10,
    rollback: false,
    support: 'community',
  },
  {
    id: 'p2',
    slug: 'pro',
    name: 'Pro',
    priceUsd: 20,
    buildMinutes: 3000,
    bandwidthGb: 100,
    rollback: true,
    support: 'email',
  },
  {
    id: 'p3',
    slug: 'business',
    name: 'Business',
    priceUsd: 80,
    buildMinutes: 10000,
    bandwidthGb: 1000,
    rollback: true,
    support: 'priority',
  },
]

// the plans with their ids assigned by a permutation of p1, p2, p3: `order[i]` is the id the i-th plan gets
export const withPlanIds = (order: readonly [string, string, string]): Plan[] =>
  plans.map((p, i) => ({ ...p, id: order[i]! }))

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

// where each plan is served from (M8e's T8 fixture, results/surfaces-t8/PLAN.md §3): two regions, each with the plans it
// serves. The fact lives on the region, since a relation is between definitions, never instances
export type Region = {
  slug: 'us-east' | 'eu-west'
  name: string
  jurisdiction: 'US' | 'EU'
  plans: Plan['slug'][]
}

export const regions: readonly Region[] = [
  { slug: 'us-east', name: 'US East', jurisdiction: 'US', plans: ['hobby', 'pro', 'business'] },
  { slug: 'eu-west', name: 'EU West', jurisdiction: 'EU', plans: ['business'] },
]

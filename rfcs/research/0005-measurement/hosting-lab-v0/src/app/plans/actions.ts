'use server'

// RFC 0005 §7's v0 rewrite of apps/hosting-lab/src/app/plans/actions.ts, by SCORING.md §3's rules. SPIKE: measurement
// input
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { defineAction } from '@/lib/affordances'
import { ensureSession } from '@/lib/session'
import * as store from '@/lib/store'
import plansState from './state'

export const listPlans = defineAction({
  name: 'listPlans',
  description: 'List every plan, with its price, limits, rollback and support',
  input: z.object({}),
  expose: 'public',
  readOnly: true,
  run: () => store.planRows(),
})

export const subscribe = defineAction({
  name: 'subscribe',
  description:
    "Move a project to this plan. Charges the plan's price now, then every month until cancelled",
  input: z.object({ plan: z.string(), projectId: z.string() }),
  expose: 'confirm',
  requires: "You own the project, and The project isn't already on this plan",
  guard: () => true,
  summary: () => 'Move {project.id} to {target.name}, for {target.priceUsd} USD a month',
  state: plansState,
  effects: ['project', 'plans'],
  run: async ({ plan, projectId }, ctx) => {
    const sid = ctx.session?.id ?? (await ensureSession())
    const result = store.subscribePlan(store.account(sid).id, projectId, plan)
    revalidatePath('/', 'layout')
    return result
  },
})

export const subscribeBundle = defineAction({
  name: 'subscribeBundle',
  description:
    "Move a project to the bundle's plan with its add-ons, for the bundle's one monthly price. Charges it now, then every month until cancelled",
  input: z.object({ bundle: z.string(), projectId: z.string() }),
  expose: 'confirm',
  requires: 'You own the project',
  guard: () => true,
  summary: () => 'Move {project.id} to {target.name}, for {target.priceUsd} USD a month',
  state: plansState,
  effects: ['project', 'bundles'],
  run: async ({ bundle, projectId }, ctx) => {
    const sid = ctx.session?.id ?? (await ensureSession())
    const result = store.subscribeBundle(store.account(sid).id, projectId, bundle)
    revalidatePath('/', 'layout')
    return result
  },
})

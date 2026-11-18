'use server'

// RFC 0005 §7's v0 rewrite of apps/hosting-lab/src/app/add-ons/actions.ts, by SCORING.md §3's rules. SPIKE:
// measurement input
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { defineAction } from '@/lib/affordances'
import { ensureSession } from '@/lib/session'
import * as store from '@/lib/store'
import addOnsState from './state'

export const addAddOn = defineAction({
  name: 'addAddOn',
  description:
    "Add an add-on to a project. Charges its price now, then every month until it's removed",
  input: z.object({ projectId: z.string(), addOn: z.string() }),
  expose: 'confirm',
  requires: "You own the project, and The project doesn't have it yet",
  guard: () => true,
  summary: () => 'Add {target.name} to {project.id}, for {target.priceUsd} USD a month',
  state: addOnsState,
  effects: ['addOns'],
  run: async ({ projectId, addOn }, ctx) => {
    const sid = ctx.session?.id ?? (await ensureSession())
    const result = store.addAddOn(store.account(sid).id, projectId, addOn)
    revalidatePath('/', 'layout')
    return result
  },
})

export const removeAddOn = defineAction({
  name: 'removeAddOn',
  description: 'Remove an add-on at the end of the month. Nothing already charged is refunded',
  input: z.object({ projectId: z.string(), addOn: z.string() }),
  expose: 'session',
  requires: 'You own the project, and The project has this add-on',
  guard: () => true,
  state: addOnsState,
  effects: ['addOns'],
  run: async ({ projectId, addOn }, ctx) => {
    const sid = ctx.session?.id ?? (await ensureSession())
    const result = store.removeAddOn(store.account(sid).id, projectId, addOn)
    revalidatePath('/', 'layout')
    return result
  },
})

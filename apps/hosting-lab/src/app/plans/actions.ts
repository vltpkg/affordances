'use server'

import { revalidatePath } from 'next/cache'
import { defineAction } from '@/lib/affordances'
import { ensureSession } from '@/lib/session'
import * as store from '@/lib/store'
import {
  listPlans as listCapability,
  subscribe as subscribeCapability,
  subscribeBundle as bundleCapability,
} from '@/manifest'
import plansState from './state'

export const listPlans = defineAction({
  capability: listCapability,
  name: 'listPlans',
  run: () =>
    store
      .currentPlans()
      .map(({ slug, name, priceUsd, buildMinutes, bandwidthGb, rollback, support }) => ({
        slug,
        name,
        priceUsd,
        buildMinutes,
        bandwidthGb,
        rollback,
        support,
      })),
})

export const subscribe = defineAction({
  capability: subscribeCapability,
  name: 'subscribe',
  state: plansState,
  effects: ['project', 'plans'],
  run: async ({ plan, projectId }, ctx) => {
    const sid = ctx.session?.id ?? (await ensureSession())
    const result = store.subscribePlan(sid, projectId, plan)
    revalidatePath('/', 'layout')
    return result
  },
})

export const subscribeBundle = defineAction({
  capability: bundleCapability,
  name: 'subscribeBundle',
  state: plansState,
  effects: ['project', 'bundles'],
  run: async ({ bundle, projectId }, ctx) => {
    const sid = ctx.session?.id ?? (await ensureSession())
    const result = store.subscribeBundle(sid, projectId, bundle)
    revalidatePath('/', 'layout')
    return result
  },
})
